import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function assertNativeFixtureClock() {
	const html = readFileSync(new URL('../native-consistency-harness.html', import.meta.url), 'utf8');
	const serverStart = html.indexOf("if (method === 'server.time') {");
	const serverEnd = html.indexOf("if (method === 'task.elapseditem.getlist') {", serverStart);
	assert.ok(serverStart > 0 && serverEnd > serverStart, 'Fixture server.time boundary changed');
	const serverBranch = html.slice(serverStart, serverEnd);
	const helpers = (html.match(/window\.timePortal(?:Timestamp|DateKey) = [^\n]+/g) || []).join('\n');
	const seeds = html.match(/const today = [^\n]+/g) || [];
	assert.equal(seeds.length, 2, 'Both single and batch elapsed seed clocks must be checked');
	let checks = 0;
	for (const hostOffset of [0, 180]) {
		for (const [iso, expectedDay] of [
			['2026-09-07T20:59:59.000Z', '2026-09-07'],
			['2026-09-07T21:00:00.000Z', '2026-09-08'],
			['2026-12-31T23:45:12.123Z', '2027-01-01']
		]) {
			const instant = Date.parse(iso);
			class HostDate extends Date {
				constructor(...args) { super(...(args.length ? args : [instant])); }
				static now() { return instant; }
				getFullYear() { return new Date(Number(this) + hostOffset * 60000).getUTCFullYear(); }
				getMonth() { return new Date(Number(this) + hostOffset * 60000).getUTCMonth(); }
				getDate() { return new Date(Number(this) + hostOffset * 60000).getUTCDate(); }
			}
			let serverTime;
			const context = vm.createContext({ Date:HostDate, window:{}, method:'server.time', callback:result => { serverTime = result.data(); } });
			vm.runInContext(helpers + '\n(function(){' + serverBranch + '})()', context);
			assert.equal(String(serverTime).slice(0, 10), expectedDay, `server day: host offset ${hostOffset}, instant ${iso}`);
			assert.equal(Date.parse(serverTime), instant, `server clock must represent the actual instant: host offset ${hostOffset}, ${iso}`);
			for (const seed of seeds) {
				const day = vm.runInContext('(function(){const now=new Date();' + seed + '\nreturn today;})()', context);
				assert.equal(day, expectedDay, `elapsed seed day: host offset ${hostOffset}, instant ${iso}`);
			}
			checks++;
		}
	}
	return { clocks:checks, hostOffsets:[0,180], elapsedTransports:2 };
}
