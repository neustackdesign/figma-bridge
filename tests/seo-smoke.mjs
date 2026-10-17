import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('GSC crawl readiness: robots, sitemap, canonical and distinct plugin URL', () => {
  const robots = read('robots.txt');
  const sitemap = read('sitemap.xml');
  const home = read('index.html');
  const plugin = read('plugin/index.html');
  assert.match(robots, /Sitemap: https:\/\/bridge\.neustackstudio\.com\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/api\//);
  for (const path of ['/', '/plugin/']) {
    const url = 'https://bridge.neustackstudio.com' + path;
    assert.ok(sitemap.includes('<loc>' + url + '</loc>'));
  }
  assert.match(home, /<link rel="canonical" href="https:\/\/bridge\.neustackstudio\.com\/"\s*\/>/);
  assert.match(plugin, /<link rel="canonical" href="https:\/\/bridge\.neustackstudio\.com\/plugin\/"\s*\/>/);
  assert.ok(!sitemap.includes('/api/'));
});
