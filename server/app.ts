import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  AGENTS,
  InvestigationRequestSchema,
  ScanRequestSchema,
  type AgentEvent,
  type Investigation,
  type RadarData,
} from '../shared/types';
import { sampleRadar, sampleInvestigation } from '../shared/sample';
import {
  runInvestigation,
  scanSignals,
  completeAssessment,
  challengeAssessment,
} from './orchestrator';
import { ResearchStore } from './store';
import { renderReport } from './report';
import { loadRecordings } from './recordings';

type Runner = typeof runInvestigation;
type Scanner = typeof scanSignals;
interface AppOptions {
  recordings?: Investigation[];
  finisher?: typeof completeAssessment;
  challenger?: typeof challengeAssessment;
  store?: ResearchStore;
  runner?: Runner;
  scanner?: Scanner;
  configured?: () => boolean;
  staticDirectory?: string;
}
export function createApp(options: AppOptions = {}) {
  const app = express();
  const store = options.store ?? new ResearchStore();
  const recordings = options.recordings ?? loadRecordings();
  const listRuns = () =>
    [...new Map([...recordings, ...store.list()].map((run) => [run.id, run])).values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    );
  const runner = options.runner ?? runInvestigation;
  const finisher = options.finisher ?? completeAssessment;
  const challenger = options.challenger ?? challengeAssessment;
  const scanner = options.scanner ?? scanSignals;
  const configured = options.configured ?? (() => Boolean(process.env.ANTHROPIC_API_KEY?.trim()));
  const controllers = new Map<string, AbortController>();
  const subscribers = new Map<string, Set<Response>>();
  let scanInProgress = false;
  const usage: number[] = [];
  const maxPerHour = Number(process.env.MAX_RESEARCH_RUNS_PER_HOUR) || 20;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let origin: URL;
      try {
        origin = new URL(req.headers.origin);
      } catch {
        return res.status(403).json({ error: 'Invalid request origin.' });
      }
      const allowedOrigins = new Set([
        `${req.protocol}://${req.headers.host}`,
        ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : []),
      ]);
      if (!allowedOrigins.has(origin.origin))
        return res.status(403).json({ error: 'Cross-origin research requests are not allowed.' });
    }
    next();
  });
  const requireResearch = (_req: Request, res: Response, next: NextFunction) => {
    if (!configured())
      return res.status(503).json({
        error:
          'Live research needs an Anthropic API key. Add ANTHROPIC_API_KEY to .env, then restart the app. The research sample is available now.',
        code: 'API_KEY_MISSING',
      });
    const now = Date.now();
    while (usage.length && usage[0] < now - 3600000) usage.shift();
    if (usage.length >= maxPerHour)
      return res.status(429).json({
        error:
          'The hourly research budget has been reached. Saved investigations remain available.',
      });
    next();
  };
  const getRun = (id: string) =>
    store.investigations.get(id) ??
    (recordings.some((run) => run.id === id)
      ? structuredClone(recordings.find((run) => run.id === id)!)
      : undefined) ??
    (id === sampleInvestigation.id ? structuredClone(sampleInvestigation) : undefined);
  function broadcast(run: Investigation) {
    store.save(run);
    const message = `data: ${JSON.stringify(run)}\n\n`;
    for (const response of subscribers.get(run.id) ?? []) response.write(message);
  }
  function start(
    query: string,
    company?: Investigation['company'],
    signalId?: string,
  ): Investigation {
    const run: Investigation = {
      id: randomUUID(),
      title: company ? `${company.name}: investment investigation` : query.slice(0, 90),
      query,
      company,
      signalId,
      mode: 'live',
      status: 'running',
      createdAt: new Date().toISOString(),
      agents: AGENTS.map((a) => ({ id: a.id, status: 'queued' })),
      events: [],
      evidence: [],
      confidence: 'INSUFFICIENT',
      watched: false,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };
    store.save(run);
    const controller = new AbortController();
    controllers.set(run.id, controller);
    usage.push(Date.now());
    const timeout = setTimeout(
      () => controller.abort(new Error('Investigation reached its execution time limit.')),
      Math.min(1800, Math.max(30, Number(process.env.MAX_INVESTIGATION_SECONDS) || 720)) * 1000,
    );
    void runner(run, (_event: AgentEvent) => broadcast(run), controller.signal)
      .catch((error: unknown) => {
        if (run.status !== 'cancelled') {
          run.status = run.evidence.length ? 'partial' : 'failed';
          run.error = error instanceof Error ? error.message : 'Research failed unexpectedly.';
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        controllers.delete(run.id);
        if (run.status === 'running') {
          run.status = run.evidence.length ? 'partial' : 'failed';
          run.error =
            run.error ||
            'Research ended without a final assessment. Available findings were saved.';
        }
        run.completedAt = new Date().toISOString();
        broadcast(run);
      });
    return run;
  }
  function followup(run: Investigation, work: Runner, seconds: number) {
    const controller = new AbortController();
    controllers.set(run.id, controller);
    usage.push(Date.now());
    const timeout = setTimeout(() => controller.abort(), seconds * 1000);
    void work(run, () => broadcast(run), controller.signal)
      .catch((error: unknown) => {
        if (run.status !== 'cancelled') {
          run.status = 'partial';
          run.error = error instanceof Error ? error.message : 'Assessment recovery failed.';
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        controllers.delete(run.id);
        if (run.status === 'running') {
          run.status = 'partial';
          run.error = 'The follow-up did not complete. Earlier research is preserved.';
        }
        run.completedAt = new Date().toISOString();
        broadcast(run);
      });
    return run;
  }
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/status', (_req, res) =>
    res.json({
      configured: configured(),
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      activeRuns: controllers.size,
      version: '0.1.0',
      webSearch: 'web_search_20250305',
      committeeModel:
        process.env.ANTHROPIC_COMMITTEE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    }),
  );
  app.get('/api/radar', (_req, res) => res.json(store.radar ?? sampleRadar));
  app.get('/api/sample', (_req, res) => res.json(getRun(sampleInvestigation.id)));
  app.post('/api/scan', requireResearch, async (req, res, next) => {
    const parsed = ScanRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: 'Choose a sector and keep the research query under 500 characters.' });
    if (scanInProgress)
      return res
        .status(409)
        .json({ error: 'A signal scan is already running. Please wait for it to finish.' });
    scanInProgress = true;
    usage.push(Date.now());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const radar: RadarData = await scanner(
        parsed.data.sector,
        parsed.data.query,
        controller.signal,
      );
      store.radar = radar;
      store.save();
      res.json(radar);
    } catch (error) {
      next(error);
    } finally {
      clearTimeout(timeout);
      scanInProgress = false;
    }
  });
  app.get('/api/investigations', (_req, res) => res.json(listRuns()));
  app.post('/api/investigations', requireResearch, (req, res) => {
    const parsed = InvestigationRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error:
          'Enter a company or research theme between 3 and 600 characters. Company details must have valid source URLs.',
      });
    if (controllers.size >= 2)
      return res.status(409).json({
        error:
          'Two investigations are already running. Wait or cancel a run before starting another.',
      });
    const { query, company, signalId } = parsed.data;
    res.status(202).json(start(query, company, signalId));
  });
  app.get('/api/investigations/:id', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Investigation not found.' });
    res.json(run);
  });
  app.get('/api/investigations/:id/events', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Investigation not found.' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify(run)}\n\n`);
    const listeners = subscribers.get(run.id) ?? new Set<Response>();
    listeners.add(res);
    subscribers.set(run.id, listeners);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
    req.on('close', () => {
      clearInterval(heartbeat);
      listeners.delete(res);
      if (!listeners.size) subscribers.delete(run.id);
    });
  });
  app.post('/api/investigations/:id/cancel', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Investigation not found.' });
    if (run.status === 'running') {
      run.status = 'cancelled';
      run.completedAt = new Date().toISOString();
      controllers.get(run.id)?.abort();
      for (const agent of run.agents)
        if (agent.status === 'running') {
          agent.status = 'failed';
          agent.error = 'Cancelled by user';
        }
      broadcast(run);
    }
    res.json(run);
  });
  app.patch('/api/investigations/:id', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Investigation not found.' });
    if (typeof req.body?.watched !== 'boolean')
      return res.status(400).json({ error: 'watched must be true or false.' });
    run.watched = req.body.watched;
    store.save(run);
    res.json(run);
  });
  app.post('/api/investigations/:id/complete', requireResearch, (req, res) => {
    const run = getRun(String(req.params.id));
    if (!run) return res.status(404).json({ error: 'Investigation not found.' });
    const reviewNotes =
      typeof req.body?.reviewNotes === 'string' ? req.body.reviewNotes.trim() : '';
    if (reviewNotes.length > 4000)
      return res
        .status(400)
        .json({ error: 'Keep the source-review notes under 4,000 characters.' });
    const researchComplete = AGENTS.filter((agent) => agent.id !== 'committee').every((agent) => {
      const stage = run.agents.find((candidate) => candidate.id === agent.id);
      return stage?.status === 'completed' && !!stage.output;
    });
    if (
      run.mode !== 'live' ||
      !researchComplete ||
      !(run.status === 'partial' || (run.status === 'completed' && reviewNotes))
    )
      return res.status(409).json({
        error:
          'Only completed company research can receive a final assessment. Start a fresh investigation for missing research stages.',
      });
    if (
      reviewNotes &&
      run.events.filter((event) => event.type === 'assessment_review_requested').length >= 2
    )
      return res
        .status(409)
        .json({ error: 'The committee-only source-review limit has been reached.' });
    if (controllers.size >= 2)
      return res.status(409).json({ error: 'Two investigations are already running.' });
    if (reviewNotes) {
      if (run.status === 'completed') {
        const committee = run.agents.find((agent) => agent.id === 'committee')!;
        run.events.push({
          id: randomUUID(),
          investigationId: run.id,
          timestamp: new Date().toISOString(),
          type: 'assessment_invalidated',
          message: 'A source-quality audit requested a revised committee memo.',
          payload: {
            previousDecision: run.decision,
            previousConfidence: run.confidence,
            previousOutput: committee.output,
          },
        });
        committee.status = 'queued';
        delete committee.output;
        run.status = 'partial';
        delete run.decision;
        run.confidence = 'INSUFFICIENT';
      }
      run.reviewNotes = [...(run.reviewNotes ?? []), reviewNotes];
      run.events.push({
        id: randomUUID(),
        investigationId: run.id,
        timestamp: new Date().toISOString(),
        type: 'assessment_review_requested',
        message: 'External source-review notes supplied for the committee assessment.',
        payload: { reviewNotes },
      });
    }
    res.status(202).json(followup(run, finisher, 180));
  });
  app.post('/api/investigations/:id/challenge', requireResearch, (req, res) => {
    const run = getRun(String(req.params.id));
    if (!run) return res.status(404).json({ error: 'Investigation not found.' });
    const claim = typeof req.body?.claim === 'string' ? req.body.claim.trim() : '';
    if (claim.length < 8 || claim.length > 2000)
      return res
        .status(400)
        .json({ error: 'Enter a specific disputed claim between 8 and 2,000 characters.' });
    if (
      run.mode !== 'live' ||
      !['completed', 'partial'].includes(run.status) ||
      !AGENTS.filter((agent) => agent.id !== 'committee').every((agent) => {
        const stage = run.agents.find((candidate) => candidate.id === agent.id);
        return stage?.status === 'completed' && !!stage.output;
      })
    )
      return res.status(409).json({
        error:
          'Complete the company research before challenging its thesis. Research samples require a new live investigation.',
      });
    if (
      run.events.filter((event) => event.type === 'agent_started' && event.agentId === 'verifier')
        .length >= 2
    )
      return res.status(409).json({
        error:
          'This investigation has reached its two-round verification limit. Start a fresh investigation for further research.',
      });
    if (controllers.size >= 2)
      return res.status(409).json({ error: 'Two investigations are already running.' });
    res
      .status(202)
      .json(
        followup(run, (current, update, signal) => challenger(current, update, signal, claim), 360),
      );
  });
  app.post('/api/investigations/:id/recheck', requireResearch, (req, res) => {
    const old = getRun(String(req.params.id));
    if (!old) return res.status(404).json({ error: 'Investigation not found.' });
    if (controllers.size >= 2)
      return res.status(409).json({ error: 'Two investigations are already running.' });
    const run = start(
      `Reassess this thesis using new public evidence. Original question: ${old.query.slice(0, 500)}. Prior decision: ${old.decision ?? 'unknown'}. Check whether material evidence changed since ${old.completedAt ?? old.createdAt}.`,
      old.company,
      old.signalId,
    );
    run.watched = true;
    store.save(run);
    res.status(202).json(run);
  });
  app.get('/api/investigations/:id/export', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Investigation not found.' });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="parallax-${run.id.replace(/[^a-zA-Z0-9-]/g, '')}.md"`,
    );
    res.send(renderReport(run));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  const staticDirectory = options.staticDirectory ?? resolve('dist');
  app.use(express.static(staticDirectory));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(staticDirectory, 'index.html')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const raw =
      error instanceof Error ? error.message : 'An unexpected error interrupted research.';
    const message = raw.replace(/sk-ant-[\w-]+/g, '[redacted]');
    res.status(error instanceof SyntaxError ? 400 : 502).json({ error: message.slice(0, 700) });
  });
  return {
    app,
    store,
    shutdown() {
      for (const controller of controllers.values()) controller.abort();
      for (const responses of subscribers.values())
        for (const response of responses) response.end();
    },
  };
}
