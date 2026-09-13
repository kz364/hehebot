import {describe,it,expect} from 'vitest';
import {FlightRestoreLedger,flightRestoreDeadline,type FlightRestoreInput} from '../src/core/flight-restore';
import {fixture} from './helpers';
const input:FlightRestoreInput={leg_id:'synthetic-leg',revision:1,departure_at:'2026-09-12T06:00:00+08:00',departure_zone:'Asia/Singapore',routine_id:'restore-routine',source_ref:'synthetic-mail'};
describe('flight restore deadlines',()=>{
 it('early flight uses prior-day minus-eight-hours rather than four AM',()=>expect(flightRestoreDeadline(input.departure_at,input.departure_zone)).toBe('2026-09-11T14:00:00.000Z'));
 it('late departure uses four AM Singapore',()=>expect(flightRestoreDeadline('2026-09-12T20:00:00+08:00','Asia/Singapore')).toBe('2026-09-11T20:00:00.000Z'));
 it('uses departure date expressed in Singapore across airport midnight and DST',()=>{
  expect(flightRestoreDeadline('2026-09-11T23:30:00-07:00','America/Los_Angeles')).toBe('2026-09-11T20:00:00.000Z');
  expect(flightRestoreDeadline('2026-11-01T01:30:00-07:00','America/Los_Angeles')).toBe('2026-10-31T20:00:00.000Z');
 });
 it.each(['2026-09-12','2026-09-12T06:00:00','2026-02-30T06:00:00Z','2026-09-12T25:00:00Z','2026-09-12T06:00:00+14:30'])('rejects ambiguous or invalid timestamp %s',value=>expect(()=>flightRestoreDeadline(value,'Asia/Singapore')).toThrow());
 it('rejects nonexistent or bare-offset timezone',()=>{expect(()=>flightRestoreDeadline(input.departure_at,'Invented/Zone')).toThrow();expect(()=>flightRestoreDeadline(input.departure_at,'+08:00')).toThrow();});
 it('idempotently creates revisions, recomputes deadline and rejects changed same revision',()=>{
  const f=fixture();try{const ledger=new FlightRestoreLedger(f.store);ledger.initialize();const a=ledger.put(input);expect(ledger.put(input)).toEqual(a);expect(()=>ledger.put({...input,source_ref:'different'})).toThrow();ledger.put({...input,revision:2,departure_at:'2026-09-13T20:00:00+08:00'});expect(ledger.nextDue()).toBe('2026-09-12T20:00:00.000Z');expect(f.db.all<{status:string}>('SELECT status FROM flight_restore_deadlines WHERE revision=1')[0].status).toBe('superseded');}finally{f.close();}
 });
 it('alarm and daily reconciliation dedupe durable enqueue across restart',()=>{
  const f=fixture();try{let ledger=new FlightRestoreLedger(f.store);ledger.initialize();ledger.put(input);const calls:string[]=[];const enqueue=(j:{occurrence_key:string})=>{calls.push(j.occurrence_key);return 'run-1';};expect(ledger.reconcile('2026-09-11T14:00:00Z',enqueue)).toBe(1);ledger=new FlightRestoreLedger(f.store);expect(ledger.reconcile('2026-09-12T00:00:00Z',enqueue)).toBe(0);expect(calls).toEqual(['flight-restore:synthetic-leg:1']);expect(ledger.nextDue()).toBeNull();ledger.confirm(input.leg_id,1,'run-1',{labels_verified:true});expect(()=>ledger.confirm(input.leg_id,1,'run-1',{})).toThrow();}finally{f.close();}
 });
 it('past deadline is immediately due; failed enqueue rolls back',()=>{
  const f=fixture();try{const ledger=new FlightRestoreLedger(f.store);ledger.initialize();ledger.put(input);expect(ledger.due('2026-09-20T00:00:00Z')).toHaveLength(1);expect(()=>ledger.reconcile('2026-09-20T00:00:00Z',()=>{throw Error('blocked');})).toThrow();expect(ledger.due('2026-09-20T00:00:00Z')).toHaveLength(1);}finally{f.close();}
 });
 it('unknown old revision blocks new restoration and cannot confirm with wrong run',()=>{
  const f=fixture();try{const ledger=new FlightRestoreLedger(f.store);ledger.initialize();ledger.put(input);ledger.reconcile('2026-09-20T00:00:00Z',()=> 'run-1');ledger.markUnknown(input.leg_id,1,'run-1');ledger.put({...input,revision:2,departure_at:'2026-09-13T20:00:00+08:00'});expect(ledger.due('2026-09-20T00:00:00Z')).toEqual([]);expect(()=>ledger.confirm(input.leg_id,1,'wrong',{ok:true})).toThrow();ledger.confirm(input.leg_id,1,'run-1',{labels_verified:true});expect(ledger.due('2026-09-20T00:00:00Z')).toHaveLength(1);}finally{f.close();}
 });
});
