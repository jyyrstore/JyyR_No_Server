'use client';
export function CopyOtp({otp}:{otp:string}){return <button className="btn btn-primary mt-4" onClick={async()=>{await navigator.clipboard.writeText(otp)}}>Copy OTP</button>}
