import { cookies } from "next/headers";
import { handleApi } from "@/lib/router.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dispatch(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  const jar = await cookies();
  return handleApi(req, path, {
    get: (name: string) => jar.get(name),
    set: (name: string, value: string, options: Parameters<typeof jar.set>[2]) => {
      jar.set(name, value, options);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  });
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
