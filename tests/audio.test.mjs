import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../audio.mjs';
function harness(preference = null) {
  let created=0, notes=0, stopped=0;const timers=new Set();const stored=new Map(preference ? [['promalp_sound',preference]] : []);
  const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}});
  class FakeContext {
    constructor(){created++;this.state='running';this.currentTime=0;this.destination={};}
    createGain(){return {gain:param(),connect(){},disconnect(){}};}
    createOscillator(){return {frequency:param(),connect(){},disconnect(){},start(){notes++;},stop(at){if(at===undefined){stopped++;this.onended?.();}}};}
    async resume(){this.state='running';}
    close(){this.state='closed';}
  }
  const audio=createAudio({Context:FakeContext,preferences:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},interval:fn=>{timers.add(fn);return fn;},clear:fn=>timers.delete(fn)});
  return {audio,timers,stored,snapshot:()=>({created,notes,stopped})};
}
test('audio is silent before a gesture and repeated unlocks use one context and scheduler',async()=>{
  const h=harness();h.audio.update('home');assert.equal(h.snapshot().created,0);
  await h.audio.unlock();assert.equal(h.snapshot().created,1);assert.ok(h.snapshot().notes>0);assert.equal(h.timers.size,1);
  await h.audio.unlock();assert.equal(h.snapshot().created,1);assert.equal(h.timers.size,1);h.audio.destroy();assert.equal(h.timers.size,0);
});
test('mute cancels scheduled music and effects and persists user choice',async()=>{
  const h=harness();await h.audio.unlock();await h.audio.toggle();assert.equal(h.audio.enabled,false);assert.equal(h.timers.size,0);assert.equal(h.stored.get('promalp_sound'),'off');
  const notes=h.snapshot().notes;h.audio.effect('coin');await h.audio.unlock();assert.equal(h.snapshot().notes,notes);
  await h.audio.toggle();assert.equal(h.audio.enabled,true);assert.equal(h.timers.size,1);h.audio.destroy();
});
test('pause and hidden page stop playback, resume does not create a second scheduler',async()=>{
  const h=harness();await h.audio.unlock();h.audio.update('paused');assert.equal(h.timers.size,0);
  h.audio.update('playing');assert.equal(h.timers.size,1);h.audio.update('playing',true);assert.equal(h.timers.size,0);
  const n=h.snapshot().notes;h.audio.effect('finish');assert.equal(h.snapshot().notes,n);
  h.audio.update('playing',false);assert.equal(h.timers.size,1);h.audio.destroy();
});
test('remembered mute and unsupported audio never block gameplay',async()=>{
  const h=harness('off');await h.audio.unlock();assert.equal(h.snapshot().created,0);
  const unsupported=createAudio({Context:null,preferences:{getItem(){return null;}}});assert.equal(await unsupported.unlock(),false);unsupported.effect('coin');unsupported.update('playing');unsupported.destroy();
});
