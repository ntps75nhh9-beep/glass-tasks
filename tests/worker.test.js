import test from 'node:test';import assert from 'node:assert/strict';import {sign,verify,pathsafe} from '../src/worker.js';
test('signed session round-trip',async()=>{const token=await sign({sub:'123',exp:Date.now()+10000},'secret');assert.equal((await verify(token,'secret')).sub,'123')});
test('tampered session rejected',async()=>{const token=await sign({sub:'123',exp:Date.now()+10000},'secret');assert.equal(await verify(token+'x','secret'),null)});
test('expired session rejected',async()=>{const token=await sign({sub:'123',exp:Date.now()-1000},'secret');assert.equal(await verify(token,'secret'),null)});
test('unsafe task IDs rejected',()=>{assert.equal(pathsafe('../bad'),false);assert.equal(pathsafe('valid_12'),true)});
