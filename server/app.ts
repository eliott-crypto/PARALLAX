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
import { z } from 'zod';
import { BoardRequestSchema, type ThemeBoard } from '../shared/boards';
import {
  createThemeBoard,
  runThemeBoard,
  fillThemeBoardGaps,
  replaceUnpricedCandidates,
} from './boards';
import { loadBoardRecordings } from './board-recordings';

type Runner = typeof runInvestigation;
type Scanner = typeof scanSignals;
interface AppOptions {
  boardRunner?: typeof runThemeBoard;
  boardFiller?: typeof fillThemeBoardGaps;
  boardReplacer?: typeof replaceUnpricedCandidates;
  boardRecordings?: ThemeBoard[];
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
  const boardRunner = options.boardRunner ?? runThemeBoard;
  const boardFiller = options.boardFiller ?? fillThemeBoardGaps;
  const boardReplacer = options.boardReplacer ?? replaceUnpricedCandidates;
  for (const board of options.boardRecordings ?? loadBoardRecordings())
    if (!store.boards.has(board.id)) store.boards.set(board.id, board);
  if (!store.boards.size) {
    const titles = new Set<string>();
    for (const run of listRuns().filter((run) => run.mode !== 'sample')) {
      const title = /orbital|space|datacenter/i.test(run.query)
        ? 'Space data centers'
        : /browser/i.test(run.query)
          ? 'Browser agents'
          : run.company?.category || run.title;
      if (titles.has(title)) continue;
      titles.add(title);
      const board = createThemeBoard(
        title.slice(0, 100),
        run.query.length >= 10
          ? run.query.slice(0, 700)
          : `Investigate private startups positioned to benefit from ${title}, comparing disclosed valuations, evidence and risks.`,
      );
      store.boards.set(board.id, board);
    }
    if (store.boards.size) store.save();
  }
  const configured = options.configured ?? (() => Boolean(process.env.ANTHROPIC_API_KEY?.trim()));
  const controllers = new Map<string, AbortController>();
  const subscribers = new Map<string, Set<Response>>();
  const boardSubscribers = new Map<string, Set<Response>>();
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
    if (run.status !== 'running')
      for (const board of store.boards.values()) {
        const candidate = board.candidates.find((item) => item.researchId === run.id);
        if (!candidate || candidate.latestReview?.checkedAt === run.completedAt) continue;
        const committee = run.agents.find((agent) => agent.id === 'committee')?.output;
        if (!committee) continue;
        const verifier = run.agents.find((agent) => agent.id === 'verifier')?.output;
        const evidence = new Map(
          [...board.evidence, ...run.evidence].map((entry) => [entry.id, entry]),
        );
        board.evidence = [...evidence.values()];
        candidate.latestReview = {
          investigationId: run.id,
          checkedAt: run.completedAt ?? new Date().toISOString(),
          confidence: run.confidence,
          decision: run.decision,
          verification: verifier?.verification,
          summary: committee.summary,
          evidenceIds: committee.findings.flatMap((finding) => finding.evidenceIds),
        };
        board.updatedAt = new Date().toISOString();
        board.events.push({
          id: randomUUID(),
          timestamp: board.updatedAt,
          type: 'ranking',
          message: `${candidate.company.name}: a full nine-agent review updated the evidence map. Comparative rank remains the committee's prior shortlist until the next theme refresh.`,
        });
        saveBoard(board);
      }
    const message = `data: ${JSON.stringify(run)}\n\n`;
    for (const response of subscribers.get(run.id) ?? []) response.write(message);
  }
  function saveBoard(board: ThemeBoard) {
    store.boards.set(board.id, board);
    store.save();
    const message = `data: ${JSON.stringify(board)}\n\n`;
    for (const response of boardSubscribers.get(board.id) ?? []) response.write(message);
  }
  function startBoard(board: ThemeBoard, fillGaps = false, replaceUnpriced = false) {
    const controller = new AbortController();
    controllers.set(board.id, controller);
    usage.push(Date.now());
    board.status = 'running';
    saveBoard(board);
    const timeout = setTimeout(() => controller.abort(), 720_000);
    void (replaceUnpriced ? boardReplacer : fillGaps ? boardFiller : boardRunner)(
      board,
      saveBoard,
      controller.signal,
    )
      .catch((error: unknown) => {
        if (board.status !== 'cancelled') {
          board.status = board.candidates.length ? 'partial' : 'failed';
          board.error = error instanceof Error ? error.message : 'Shortlist research failed.';
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        if (controllers.get(board.id) === controller) controllers.delete(board.id);
        if (board.status === 'running') {
          board.status = board.candidates.length ? 'partial' : 'failed';
          board.error ||= 'Shortlist research ended before a final ranking.';
        }
        board.updatedAt = new Date().toISOString();
        saveBoard(board);
      });
    return board;
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
        run.completedAt ||= new Date().toISOString();
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
        run.completedAt ||= new Date().toISOString();
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
  app.get('/api/boards', (_req, res) =>
    res.json([...store.boards.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
  );
  app.post('/api/boards', requireResearch, (req, res) => {
    const parsed = BoardRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: 'Name the theme and describe the commercial change you want to investigate.',
      });
    if (controllers.size >= 2)
      return res
        .status(409)
        .json({ error: 'Two research teams are already running. Wait or cancel one first.' });
    const board = createThemeBoard(
      parsed.data.title,
      parsed.data.thesis,
      parsed.data.preferredValuationMaxUsd,
    );
    res.status(202).json(startBoard(board));
  });
  app.get('/api/boards/:id', (req, res) => {
    const board = store.boards.get(String(req.params.id));
    if (!board) return res.status(404).json({ error: 'Theme not found.' });
    res.json(board);
  });
  app.patch('/api/boards/:id', (req, res) => {
    const board = store.boards.get(String(req.params.id));
    if (!board) return res.status(404).json({ error: 'Theme not found.' });
    const parsed = z
      .object({ order: z.array(z.string()).max(5).optional(), resetOrder: z.boolean().optional() })
      .strict()
      .safeParse(req.body);
    if (!parsed.success || (!parsed.data.order && !parsed.data.resetOrder))
      return res.status(400).json({ error: 'Provide a complete shortlist order or resetOrder.' });
    if (board.status === 'running')
      return res.status(409).json({ error: 'Wait for the ranking to finish before reordering.' });
    if (parsed.data.order) {
      const ids = board.candidates.map((candidate) => candidate.companyId);
      if (
        parsed.data.order.length !== ids.length ||
        new Set(parsed.data.order).size !== ids.length ||
        parsed.data.order.some((id) => !ids.includes(id))
      )
        return res.status(400).json({ error: 'Include each shortlisted company exactly once.' });
      for (const candidate of board.candidates)
        candidate.manualRank = parsed.data.order.indexOf(candidate.companyId) + 1;
    } else for (const candidate of board.candidates) delete candidate.manualRank;
    board.updatedAt = new Date().toISOString();
    saveBoard(board);
    res.json(board);
  });
  app.post('/api/boards/:id/refresh', requireResearch, (req, res) => {
    const board = store.boards.get(String(req.params.id));
    if (!board) return res.status(404).json({ error: 'Theme not found.' });
    if (board.status === 'running' || controllers.has(board.id) || controllers.size >= 2)
      return res
        .status(409)
        .json({ error: 'Research is already running. Wait or cancel a team first.' });
    res.status(202).json(startBoard(board));
  });
  app.post('/api/boards/:id/complete', requireResearch, (req, res) => {
    const board = store.boards.get(String(req.params.id));
    if (!board) return res.status(404).json({ error: 'Theme not found.' });
    if (board.status === 'running' || controllers.has(board.id) || controllers.size >= 2)
      return res.status(409).json({ error: 'Wait for the active research team to finish.' });
    if (
      !board.evidence.length ||
      board.candidates.length >= 5 ||
      board.agents.some((agent) => agent.id === 'scout-replacement')
    )
      return res
        .status(409)
        .json({
          error:
            'This shortlist cannot use another gap-recovery pass. Refresh the theme for fresh research.',
        });
    const related = new Map<string, Investigation>();
    for (const run of listRuns().filter(
      (run) =>
        run.mode !== 'sample' &&
        run.status === 'completed' &&
        run.company &&
        (!board.preferredValuationMaxUsd || board.preferredValuationMaxUsd > 500_000_000),
    )) {
      const domain = new URL(run.company!.website).hostname.replace(/^www\./, '');
      if (!related.has(domain)) related.set(domain, run);
    }
    board.relatedCompanies = [...related.values()].slice(0, 6).map((run) => run.company!);
    const sources = new Map(board.evidence.map((entry) => [entry.id, entry]));
    for (const run of [...related.values()].slice(0, 6)) {
      const domain = new URL(run.company!.website).hostname.replace(/^www\./, '');
      const official = run.evidence.find(
        (entry) =>
          entry.status === 'SUPPORTED' &&
          new URL(entry.url).hostname.replace(/^www\./, '') === domain,
      );
      const financing = run.evidence
        .filter(
          (entry) =>
            entry.status === 'SUPPORTED' &&
            /valu(?:ation|ed)|post.money/i.test(`${entry.claim} ${entry.summary}`),
        )
        .slice(0, 3);
      for (const entry of [official, ...financing]) if (entry) sources.set(entry.id, entry);
    }
    board.evidence = [...sources.values()];
    if (related.size) board.events.push({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'ranking',
      message:
        'Earlier completed investigations supplied historical company leads and financing sources. Their original retrieval dates are retained; the Gap Scout must independently recheck fit and pricing.',
    });
    res.status(202).json(
      startBoard(
        board,
        true,
        board.agents.some((agent) => agent.id === 'scout-gap'),
      ),
    );
  });
  app.post('/api/boards/:id/candidates/:companyId/research', requireResearch, (req, res) => {
    const board = store.boards.get(String(req.params.id));
    if (!board) return res.status(404).json({ error: 'Theme not found.' });
    const candidate = board.candidates.find((item) => item.companyId === req.params.companyId);
    if (!candidate) return res.status(404).json({ error: 'Shortlisted company not found.' });
    if (board.status === 'running' || controllers.has(board.id) || controllers.size >= 2)
      return res.status(409).json({ error: 'Wait for the active research team to finish.' });
    if (candidate.researchId && controllers.has(candidate.researchId))
      return res.status(409).json({ error: 'This company already has a research team running.' });
    const parsed = z
      .object({ challenge: z.boolean().default(false) })
      .strict()
      .safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: 'Choose a research or Red Team investigation.' });
    const query =
      `${parsed.data.challenge ? 'RED TEAM: try to falsify the specific thesis-breaking claim' : 'Investigate this shortlisted private startup'} for ${candidate.company.name}. Theme: ${board.title}. Key claim: ${candidate.killCriterion}. Proof needed: ${candidate.nextProof}. Independently verify with fresh sources; let Bull revise after Bear and Verifier.`.slice(
        0,
        600,
      );
    const investigation = start(query, candidate.company);
    candidate.researchId = investigation.id;
    board.updatedAt = new Date().toISOString();
    saveBoard(board);
    res.status(202).json({ board, investigation });
  });
  app.post('/api/boards/:id/cancel', (req, res) => {
    const board = store.boards.get(String(req.params.id));
    if (!board) return res.status(404).json({ error: 'Theme not found.' });
    if (board.status === 'running') {
      board.status = 'cancelled';
      controllers.get(board.id)?.abort();
      board.updatedAt = new Date().toISOString();
      saveBoard(board);
    }
    res.json(board);
  });
  app.get('/api/boards/:id/events', (req, res) => {
    const board = store.boards.get(String(req.params.id));
    if (!board) return res.status(404).json({ error: 'Theme not found.' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify(board)}\n\n`);
    const listeners = boardSubscribers.get(board.id) ?? new Set<Response>();
    listeners.add(res);
    boardSubscribers.set(board.id, listeners);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
    req.on('close', () => {
      clearInterval(heartbeat);
      listeners.delete(res);
      if (!listeners.size) boardSubscribers.delete(board.id);
    });
  });
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
      run.completedAt ||= new Date().toISOString();
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
      for (const responses of boardSubscribers.values())
        for (const response of responses) response.end();
    },
  };
}
