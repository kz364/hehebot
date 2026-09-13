import { ControlError, safeError } from '../core/errors';
export type RpcResult<T>={ok:true;value:T}|{ok:false;error:ReturnType<typeof safeError>;status:number};
/** Custom Error properties do not survive the DO RPC boundary. Return a typed envelope. */
export async function rpcResult<T>(fn:()=>T|Promise<T>):Promise<RpcResult<T>>{
 try{return {ok:true,value:await fn()};}catch(error){return {ok:false,error:safeError(error),status:error instanceof ControlError?error.status:500};}
}
export function unwrap<T>(result:RpcResult<T>):T{
 if(result.ok)return result.value;
 throw new ControlError(result.error.code,result.error.message,result.status,result.error.retryable);
}
