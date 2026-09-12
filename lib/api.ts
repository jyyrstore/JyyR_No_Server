import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

export function requestId(request: Request) {
  return request.headers.get('x-request-id')?.trim() || `req_${randomUUID().replaceAll('-', '')}`;
}

export function apiError(code: string, message: string, status: number, reqId: string) {
  return NextResponse.json({ error: { code, message, request_id: reqId } }, { status, headers: { 'x-request-id': reqId } });
}

export function apiOk<T>(data: T, reqId: string, status = 200) {
  return NextResponse.json({ data, request_id: reqId }, { status, headers: { 'x-request-id': reqId } });
}
