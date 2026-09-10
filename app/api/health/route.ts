import { NextResponse } from 'next/server';
export async function GET(){return NextResponse.json({ok:true,service:"Jyy'R Number Server",timestamp:new Date().toISOString()});}
