import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSourceUrl, sourceCount, uniqueSources } from '../src/lib/api';

test('source counts deduplicate fragment, tracking and trailing-slash variants', () => {
  const records = [
    { url: 'https://example.org/research/', claim: 'Initial finding' },
    { url: 'https://example.org/research#results', claim: 'A second claim' },
    { url: 'https://example.org/research?utm_source=scout&utm_campaign=research&fbclid=tracking', claim: 'A third claim' },
    { url: 'https://example.org/other', claim: 'Independent source' },
  ];
  assert.equal(sourceCount(records), 2);
  assert.equal(uniqueSources(records).length, 2);
});

test('meaningful query parameters identify distinct documents and normalize parameter order', () => {
  const first = 'https://example.org/document?id=one&language=en';
  const reordered = 'https://example.org/document?language=en&id=one#top';
  const second = 'https://example.org/document?id=two&language=en';
  assert.equal(canonicalSourceUrl(first), canonicalSourceUrl(reordered));
  assert.equal(sourceCount([{ url: first }, { url: reordered }, { url: second }]), 2);
  assert.notEqual(canonicalSourceUrl(first), canonicalSourceUrl(second));
});

test('malformed source URLs remain safe to count without throwing', () => {
  assert.equal(canonicalSourceUrl('  not a valid URL  '), 'not a valid URL');
  assert.doesNotThrow(() => sourceCount([{ url: 'not a valid URL' }, { url: '' }]));
  assert.equal(sourceCount([]), 0);
});

test('counting unique sources does not mutate or remove underlying claim records', () => {
  const first = Object.freeze({ id: 'claim-one', url: 'https://example.org/research/#first', claim: 'Product exists' });
  const second = Object.freeze({ id: 'claim-two', url: 'https://example.org/research?utm_source=agent', claim: 'Product positioning' });
  const records = Object.freeze([first, second]);
  const original = JSON.stringify(records);
  assert.equal(sourceCount(records), 1);
  assert.equal(uniqueSources(records).length, 1);
  assert.equal(records.length, 2);
  assert.equal(records[0], first);
  assert.equal(records[1], second);
  assert.equal(JSON.stringify(records), original);
});
