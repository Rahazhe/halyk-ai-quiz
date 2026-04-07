// supabase/functions/submit-quiz/index.ts
// Supabase Edge Function for Halyk AI Quiz — Demo Day Edition
// Handles: validation, rate limiting, server-side scoring, sanitization, persistence

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// ---------------------------------------------------------------------------
// CORS headers — allow all origins (demo day, multiple devices)
// ---------------------------------------------------------------------------
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Rate-limit map: IP hash -> last request timestamp (ms)
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 request per IP per 60 seconds

// ---------------------------------------------------------------------------
// Questions scoring data — EXACT weights from plan
// ---------------------------------------------------------------------------
const QUESTIONS = [
  // Q1: Когда вы слышите "ИИ в банкинге"
  { options: [
    { scores: { tax_adviser: 1, voice: 1, chat: 3 }, profile: { pragmatist: 2, optimizer: 1, visionary: 0 } },
    { scores: { tax_adviser: 0, voice: 3, chat: 1 }, profile: { pragmatist: 1, optimizer: 1, visionary: 1 } },
    { scores: { tax_adviser: 3, voice: 0, chat: 1 }, profile: { pragmatist: 1, optimizer: 2, visionary: 1 } },
    { scores: { tax_adviser: 1, voice: 2, chat: 2 }, profile: { pragmatist: 2, optimizer: 2, visionary: 0 } },
  ]},
  // Q2: Что вас больше впечатляет в современном ИИ
  { options: [
    { scores: { tax_adviser: 1, voice: 3, chat: 1 }, profile: { pragmatist: 1, optimizer: 0, visionary: 2 } },
    { scores: { tax_adviser: 1, voice: 1, chat: 3 }, profile: { pragmatist: 2, optimizer: 2, visionary: 0 } },
    { scores: { tax_adviser: 3, voice: 0, chat: 1 }, profile: { pragmatist: 1, optimizer: 1, visionary: 2 } },
    { scores: { tax_adviser: 1, voice: 2, chat: 2 }, profile: { pragmatist: 3, optimizer: 1, visionary: 0 } },
  ]},
  // Q3: ИИ может решить одну проблему
  { options: [
    { scores: { tax_adviser: 0, voice: 3, chat: 1 }, profile: { pragmatist: 2, optimizer: 2, visionary: 0 } },
    { scores: { tax_adviser: 0, voice: 0, chat: 3 }, profile: { pragmatist: 2, optimizer: 1, visionary: 0 } },
    { scores: { tax_adviser: 3, voice: 0, chat: 1 }, profile: { pragmatist: 1, optimizer: 3, visionary: 0 } },
    { scores: { tax_adviser: 0, voice: 2, chat: 2 }, profile: { pragmatist: 1, optimizer: 3, visionary: 0 } },
  ]},
  // Q4: Как вам комфортнее взаимодействовать с ИИ
  { options: [
    { scores: { tax_adviser: 1, voice: 3, chat: 0 }, profile: { pragmatist: 1, optimizer: 1, visionary: 1 } },
    { scores: { tax_adviser: 1, voice: 0, chat: 3 }, profile: { pragmatist: 2, optimizer: 1, visionary: 0 } },
    { scores: { tax_adviser: 3, voice: 0, chat: 1 }, profile: { pragmatist: 0, optimizer: 2, visionary: 1 } },
    { scores: { tax_adviser: 1, voice: 1, chat: 1 }, profile: { pragmatist: 0, optimizer: 1, visionary: 3 } },
  ]},
  // Q5: Что вас больше всего настораживает в ИИ
  { options: [
    { scores: { tax_adviser: 1, voice: 1, chat: 2 }, profile: { pragmatist: 3, optimizer: 1, visionary: 0 } },
    { scores: { tax_adviser: 2, voice: 2, chat: 0 }, profile: { pragmatist: 1, optimizer: 0, visionary: 2 } },
    { scores: { tax_adviser: 2, voice: 1, chat: 1 }, profile: { pragmatist: 2, optimizer: 1, visionary: 1 } },
    { scores: { tax_adviser: 1, voice: 1, chat: 2 }, profile: { pragmatist: 0, optimizer: 1, visionary: 3 } },
  ]},
  // Q6: Банк будущего — это банк, который...
  { options: [
    { scores: { tax_adviser: 3, voice: 0, chat: 1 }, profile: { pragmatist: 1, optimizer: 1, visionary: 2 } },
    { scores: { tax_adviser: 0, voice: 3, chat: 2 }, profile: { pragmatist: 2, optimizer: 1, visionary: 1 } },
    { scores: { tax_adviser: 1, voice: 1, chat: 3 }, profile: { pragmatist: 2, optimizer: 2, visionary: 0 } },
    { scores: { tax_adviser: 1, voice: 1, chat: 1 }, profile: { pragmatist: 0, optimizer: 0, visionary: 3 } },
  ]},
  // Q7: ИИ-ассистент мог бы сделать что-то прямо сейчас
  { options: [
    { scores: { tax_adviser: 3, voice: 0, chat: 0 }, profile: { pragmatist: 2, optimizer: 1, visionary: 0 } },
    { scores: { tax_adviser: 0, voice: 3, chat: 0 }, profile: { pragmatist: 2, optimizer: 1, visionary: 0 } },
    { scores: { tax_adviser: 0, voice: 0, chat: 3 }, profile: { pragmatist: 2, optimizer: 1, visionary: 0 } },
    { scores: { tax_adviser: 2, voice: 2, chat: 2 }, profile: { pragmatist: 0, optimizer: 1, visionary: 3 } },
  ]},
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags from a string and trim to maxLen characters. */
function sanitize(str: string, maxLen = 100): string {
  return str
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, maxLen);
}

/** SHA-256 hash of raw IP for dedup tracking (never store raw IP). */
async function hashIP(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface ComputedScores {
  productScores: Record<string, number>;
  profileScores: Record<string, number>;
  recommendedProduct: string;
  profile: string;
}

/** Recompute scores server-side from raw answers indices. */
function computeScores(answers: number[]): ComputedScores {
  const productScores: Record<string, number> = { tax_adviser: 0, voice: 0, chat: 0 };
  const profileScores: Record<string, number> = { visionary: 0, pragmatist: 0, optimizer: 0 };

  for (let i = 0; i < answers.length; i++) {
    const option = QUESTIONS[i].options[answers[i]];

    // Accumulate product scores
    for (const [product, weight] of Object.entries(option.scores)) {
      productScores[product] += weight;
    }

    // Accumulate profile scores
    for (const [prof, weight] of Object.entries(option.profile)) {
      profileScores[prof] += weight;
    }
  }

  // Determine winning product (highest score)
  const recommendedProduct = Object.entries(productScores).reduce(
    (best, [key, val]) => (val > best[1] ? [key, val] : best),
    ['tax_adviser', -1] as [string, number],
  )[0];

  // Determine winning profile (highest score)
  const profile = Object.entries(profileScores).reduce(
    (best, [key, val]) => (val > best[1] ? [key, val] : best),
    ['pragmatist', -1] as [string, number],
  )[0];

  return { productScores, profileScores, recommendedProduct, profile };
}

/** Build a JSON error response with CORS headers. */
function errorResponse(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: CORS_HEADERS },
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidatedBody {
  user_name: string | null;
  department: string | null;
  role: string | null;
  consent: boolean;
  answers: number[];
  device: string;
  duration_ms: number;
}

function validateBody(body: unknown): { data?: ValidatedBody; error?: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object' };
  }

  const b = body as Record<string, unknown>;

  // --- answers ---
  if (!Array.isArray(b.answers)) {
    return { error: 'answers must be an array' };
  }
  if (b.answers.length !== 7) {
    return { error: 'answers must contain exactly 7 elements' };
  }
  for (let i = 0; i < 7; i++) {
    const a = b.answers[i];
    if (!Number.isInteger(a) || a < 0 || a > 3) {
      return { error: `answers[${i}] must be an integer between 0 and 3` };
    }
  }

  // --- device ---
  if (b.device !== 'mobile' && b.device !== 'desktop') {
    return { error: 'device must be "mobile" or "desktop"' };
  }

  // --- duration_ms ---
  if (!Number.isInteger(b.duration_ms) || (b.duration_ms as number) <= 0) {
    return { error: 'duration_ms must be a positive integer' };
  }

  // --- optional text fields (sanitize) ---
  let user_name: string | null = null;
  let department: string | null = null;
  let role: string | null = null;

  if (b.user_name != null) {
    if (typeof b.user_name !== 'string') {
      return { error: 'user_name must be a string' };
    }
    user_name = sanitize(b.user_name);
    if (user_name.length === 0) {
      user_name = null;
    }
  }

  if (b.department != null) {
    if (typeof b.department !== 'string') {
      return { error: 'department must be a string' };
    }
    department = sanitize(b.department);
    if (department.length === 0) {
      department = null;
    }
  }

  if (b.role != null) {
    if (typeof b.role !== 'string') {
      return { error: 'role must be a string' };
    }
    role = sanitize(b.role);
    if (role.length === 0) {
      role = null;
    }
  }

  // --- consent ---
  const consent = b.consent === true;

  // If user_name is provided, consent must be true
  if (user_name !== null && !consent) {
    return { error: 'consent must be true when user_name is provided' };
  }

  return {
    data: {
      user_name,
      department,
      role,
      consent,
      answers: b.answers as number[],
      device: b.device as string,
      duration_ms: b.duration_ms as number,
    },
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // --- Only POST ---
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  // --- Rate limiting ---
  const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
  const ipHash = await hashIP(clientIP);

  const now = Date.now();
  const lastRequest = rateLimitMap.get(ipHash);
  if (lastRequest && now - lastRequest < RATE_LIMIT_WINDOW_MS) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - lastRequest)) / 1000);
    return errorResponse(
      `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      429,
    );
  }
  rateLimitMap.set(ipHash, now);

  // Cleanup stale entries (prevent memory leak in long-running function)
  if (rateLimitMap.size > 10_000) {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    for (const [key, ts] of rateLimitMap) {
      if (ts < cutoff) {
        rateLimitMap.delete(key);
      }
    }
  }

  // --- Parse body ---
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // --- Validate ---
  const validation = validateBody(body);
  if (validation.error) {
    return errorResponse(validation.error, 400);
  }
  const data = validation.data!;

  // --- Compute scores server-side (NEVER trust client) ---
  const { productScores, profileScores, recommendedProduct, profile } = computeScores(data.answers);

  // --- Supabase client (service_role — never exposed to client) ---
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    return errorResponse('Server configuration error', 500);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // --- Build answers JSONB [{q: 0, a: 1}, ...] ---
  const answersJsonb = data.answers.map((a, i) => ({ q: i, a }));

  // --- Insert row ---
  const { error: insertError } = await supabase.from('quiz_sessions').insert({
    user_name: data.user_name,
    department: data.department,
    role: data.role,
    consent: data.consent,
    answers: answersJsonb,
    product_scores: productScores,
    profile_scores: profileScores,
    recommended_product: recommendedProduct,
    profile,
    device: data.device,
    duration_ms: data.duration_ms,
    ip_hash: ipHash,
  });

  if (insertError) {
    console.error('Supabase insert error:', insertError);
    return errorResponse('Failed to save quiz results', 500);
  }

  // --- Get participant count ---
  const { count, error: countError } = await supabase
    .from('quiz_sessions')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('Supabase count error:', countError);
  }

  const participantNumber = count ?? 0;

  // --- Success response ---
  return new Response(
    JSON.stringify({
      success: true,
      profile,
      recommended_product: recommendedProduct,
      product_scores: productScores,
      profile_scores: profileScores,
      participant_number: participantNumber,
    }),
    { status: 200, headers: CORS_HEADERS },
  );
});
