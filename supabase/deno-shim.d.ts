// Just enough of Deno's world for `tsc -p supabase` to check the Edge Functions
// without Deno installed. The Edge runtime brings the real ones.

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

declare module 'npm:@supabase/supabase-js@2' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient(url: string, key: string, options?: unknown): any;
}

declare module 'npm:postgres@3' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export default function postgres(url: string, options?: unknown): any;
}
