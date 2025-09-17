// src/app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth";

export async function GET(request: Request) {
  return (await auth()).handler(request);
}

export async function POST(request: Request) {
  return (await auth()).handler(request);
}
