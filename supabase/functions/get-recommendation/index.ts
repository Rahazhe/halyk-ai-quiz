// supabase/functions/get-recommendation/index.ts
// Computes top-3 products via decision tree + calls OpenAI for personalized text

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Product catalog
// ---------------------------------------------------------------------------
const PRODUCTS: Record<string, { name: string; desc: string }> = {
  acquiring:    { name: 'Эквайринг',               desc: 'Приём безналичных платежей, POS-терминалы' },
  rko:          { name: 'РКО — Тарифный пакет',    desc: 'Расчётно-кассовое обслуживание для бизнеса' },
  credit:       { name: 'Цифровой кредит ИП/ТОО',  desc: 'Быстрое онлайн-кредитование для бизнеса' },
  salary:       { name: 'Зарплатный проект',        desc: 'Перевод зарплаты сотрудникам через Халык' },
  online_duken: { name: 'OnlineDuken',              desc: 'Онлайн-витрина для товаров и услуг' },
  deposit:      { name: 'Депозит',                  desc: 'Размещение свободных средств под процент' },
  guarantees:   { name: 'Гарантии ЦБТГ/БИО',       desc: 'Банковские гарантии для тендеров и контрактов' },
  dealing:      { name: 'Дилинг (Halyk FX)',        desc: 'Обмен валют, хеджирование валютных рисков' },
  mercury:      { name: 'Mercury X',                desc: 'Международные переводы нового поколения' },
  ved:          { name: 'ВЭД (ВК, дилинг)',         desc: 'Внешнеэкономическая деятельность, валютный контроль' },
  halyk_market: { name: 'Halyk Market',             desc: 'Маркетплейс Халык Банка' },
  restaurants:  { name: 'Халык-рестораны',          desc: 'Сервис подбора ресторанов для бизнес-встреч' },
  tax_adviser:  { name: 'Tax Adviser',              desc: 'Налоговое планирование и оптимизация' },
};

// ---------------------------------------------------------------------------
// Industry → product matrix
// ---------------------------------------------------------------------------
const MATRIX: Record<string, Record<string, string[]>> = {
  b2b: {
    'Предоставление услуг':               ['acquiring', 'rko', 'credit', 'salary', 'online_duken'],
    'Сельское хозяйство':                 ['credit', 'deposit', 'rko', 'guarantees', 'dealing', 'mercury'],
    'Оптовая торговля':                   ['rko', 'ved', 'credit', 'salary', 'online_duken', 'mercury'],
    'Транспорт и логистика':              ['rko', 'credit', 'salary', 'ved'],
    'Прочие строит. работы':              ['guarantees', 'rko', 'credit', 'deposit'],
    'Операции с недвижимостью':           ['rko', 'deposit', 'credit'],
    'Гос. органы, образование, здравоохр.': ['salary', 'rko', 'deposit'],
    'Лёгкая и обрабатывающая промышленность': ['rko', 'dealing', 'credit', 'deposit', 'salary', 'mercury'],
    'Производственное строительство':     ['rko', 'guarantees', 'credit', 'dealing', 'salary'],
  },
  b2c: {
    'Продуктовые магазины':               ['acquiring', 'online_duken', 'rko', 'halyk_market', 'credit', 'salary'],
    'Одежда и обувь':                     ['acquiring', 'halyk_market', 'rko', 'credit', 'ved', 'mercury'],
    'Кофейни, кафе, рестораны':           ['acquiring', 'restaurants', 'credit', 'rko', 'online_duken', 'deposit'],
    'АЗС':                                ['acquiring', 'rko', 'ved', 'credit', 'salary', 'deposit'],
    'Электроника':                        ['acquiring', 'rko', 'halyk_market', 'credit', 'ved', 'deposit'],
    'Аптеки и Оптика':                    ['acquiring', 'rko', 'halyk_market', 'online_duken', 'ved'],
    'Мед центры':                         ['acquiring', 'rko', 'credit', 'salary'],
    'Строительные товары':                ['acquiring', 'ved', 'rko', 'credit', 'mercury', 'deposit'],
    'Гостиницы, мотели':                  ['acquiring', 'rko', 'salary', 'deposit'],
    'Розничная торговля (прочее)':        ['acquiring', 'rko', 'credit', 'online_duken', 'halyk_market', 'mercury'],
  },
};

// ---------------------------------------------------------------------------
// Scoring modifiers
// ---------------------------------------------------------------------------
const Q3_MODS: Record<string, Record<string, number>> = {
  small:      { salary: -10, online_duken: 5, tax_adviser: 5 },
  medium:     { salary: 10, rko: 5, tax_adviser: 8 },
  large:      { salary: 15, ved: 5, guarantees: 5, tax_adviser: 10 },
  enterprise: { salary: 15, ved: 10, guarantees: 10, dealing: 5, tax_adviser: 15 },
};
const Q4_MODS: Record<string, Record<string, number>> = {
  finance:       { credit: 15, deposit: 5, tax_adviser: 5 },
  optimize:      { tax_adviser: 15, rko: 10, acquiring: 5 },
  international: { ved: 15, mercury: 10, dealing: 10, tax_adviser: 5 },
  automate:      { online_duken: 10, halyk_market: 10, restaurants: 5, acquiring: 5 },
};
const Q5_MODS: Record<string, Record<string, number>> = {
  full_online: { online_duken: 10, halyk_market: 10, mercury: 5, acquiring: -25 },
  partial:     { acquiring: 5, online_duken: 5 },
  offline:     { acquiring: 10, rko: 5, online_duken: -5, halyk_market: -5 },
};

const AI_TRENDS: Record<string, string> = {
  'Кофейни, кафе, рестораны':           '79% ресторанов уже внедряют или рассматривают AI-решения (Popmenu, 2024)',
  'Продуктовые магазины':               '97% ритейлеров планируют увеличить инвестиции в AI в ближайший год',
  'Одежда и обувь':                     'AI-персонализация способна увеличить конверсию до 30% в fashion-сегменте',
  'Сельское хозяйство':                 'Рынок AI в агросекторе растёт на 25–26% ежегодно (GrandView Research)',
  'Оптовая торговля':                   'AI сокращает логистические затраты на 5–20% (McKinsey)',
  'Транспорт и логистика':              'AI сокращает логистические затраты на 5–20% (McKinsey)',
  'Прочие строит. работы':              'Рынок AI в строительстве вырастет с $3.7 млрд (2024) до $22+ млрд к 2030',
  'Производственное строительство':     'Рынок AI в строительстве вырастет с $3.7 млрд (2024) до $22+ млрд к 2030',
  'Лёгкая и обрабатывающая промышленность': 'AI-проекты в производстве окупаются в среднем за 12–18 месяцев',
  'Предоставление услуг':              '89% компаний активно используют или тестируют AI-решения',
  'Гос. органы, образование, здравоохр.': '80% предприятий будут использовать GenAI в production к 2026 (Gartner)',
  'Операции с недвижимостью':           'AI способен автоматизировать значительную часть рутинных задач в недвижимости',
  'АЗС':                                'AI-оптимизация помогает снижать операционные затраты в топливном ритейле',
  'Электроника':                        'AI-рекомендации способны увеличивать средний чек в электронике',
  'Аптеки и Оптика':                   'AI улучшает точность прогнозирования спроса в фармацевтике',
  'Мед центры':                         'AI помогает ускорять обработку медицинских данных и маршрутизацию пациентов',
  'Строительные товары':                'AI-прогнозирование помогает оптимизировать складские запасы',
  'Гостиницы, мотели':                  'AI-персонализация повышает лояльность гостей и загрузку отелей',
  'Розничная торговля (прочее)':        'AI-персонализация способна увеличить конверсию на 20–35% в рознице',
};

// ---------------------------------------------------------------------------
// Decision tree scoring
// ---------------------------------------------------------------------------
function computeTop3(bType: string, industry: string, q3: string, q4: string, q5: string): string[] {
  const scores: Record<string, number> = {};
  Object.keys(PRODUCTS).forEach(k => scores[k] = 0);

  const row = (MATRIX[bType] || {})[industry] || [];
  [60, 50, 40, 30, 20, 10].forEach((pts, i) => {
    if (row[i]) scores[row[i]] = (scores[row[i]] || 0) + pts;
  });

  // Tax Adviser always gets 35 base
  scores['tax_adviser'] = Math.max(scores['tax_adviser'] || 0, 35);

  [Q3_MODS[q3], Q4_MODS[q4], Q5_MODS[q5]].forEach(mods => {
    if (!mods) return;
    Object.entries(mods).forEach(([k, v]) => { scores[k] = (scores[k] || 0) + v; });
  });

  return Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS_HEADERS });
  }

  const { business_type, industry, company_size, priority, digital_level, open_q6, open_q7, open_q8 } = body as Record<string, string>;

  if (!business_type || !industry || !company_size || !priority || !digital_level) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: CORS_HEADERS });
  }

  // Decision tree (always runs — fallback if AI fails)
  const top3 = computeTop3(business_type, industry, company_size, priority, digital_level);
  const aiTrend = AI_TRENDS[industry] || 'AI трансформирует вашу отрасль уже сегодня';

  // Human-readable labels for prompt
  const sizeLabel: Record<string, string> = { small: 'до 30 чел.', medium: '30–200 чел.', large: '200–1000 чел.', enterprise: 'более 1000 / холдинг' };
  const priorityLabel: Record<string, string> = { finance: 'привлечь финансирование', optimize: 'оптимизировать расходы', international: 'выйти на международный рынок', automate: 'автоматизировать продажи' };
  const digitalLabel: Record<string, string> = { full_online: 'полностью онлайн', partial: 'частично онлайн', offline: 'пока всё офлайн' };

  // Try OpenAI
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  let aiProducts = null;
  let personalInsight = null;
  let aiAnswer = null;
  let usedAI = false;

  if (openaiKey) {
    try {
      const top3Lines = top3.map((k, i) => `${i + 1}. ${PRODUCTS[k]?.name} — ${PRODUCTS[k]?.desc}`).join('\n');

      const freeQuestionBlock = open_q8
        ? `\n3. Участник задал вопрос: "${open_q8}"\nПравила ответа:\n- СНАЧАЛА определи тип вопроса:\n  а) Бизнес, финансы, технологии, экономика, управление, маркетинг, право в контексте бизнеса, образование, наука — ОТВЕЧАЙ как эксперт.\n  б) Общеобразовательный или познавательный вопрос (история, география, IT, здоровье в общем смысле) — можно дать короткий нейтральный ответ.\n  в) Социально чувствительные темы (секс, ЛГБТ, расовые/национальные темы, наркотики, насилие, политика, религия, оскорбления) — вежливо откажись: "Этот вопрос выходит за рамки нашей консультации. Если у вас есть вопросы о продуктах Halyk Bank — оставьте контакты ниже." Помести это в "ai_answer" и больше ничего не добавляй.\n- Если вопрос касается выбора банка в Казахстане или сравнения банков — скажи: "Halyk Bank предлагает широкий спектр продуктов для бизнеса — оставьте контакты ниже, и мы расскажем подробнее."\n- Если пользователь говорит, что другой банк лучше — не спорь: "У каждого банка свои сильные стороны. Если хотите узнать о возможностях Halyk Bank — оставьте контакты ниже."\n- Для бизнес-вопросов — давай практичный совет как независимый эксперт, без лишних упоминаний банка.\nОтвет 2–4 предложения. Помести в поле "ai_answer".`
        : '';

      const jsonSchema = open_q8
        ? `{"products":[{"key":"${top3[0]}","reason":"..."},{"key":"${top3[1]}","reason":"..."},{"key":"${top3[2]}","reason":"..."}],"personal_insight":"...","ai_answer":"..."}`
        : `{"products":[{"key":"${top3[0]}","reason":"..."},{"key":"${top3[1]}","reason":"..."},{"key":"${top3[2]}","reason":"..."}],"personal_insight":"..."}`;

      const prompt = `Ты — AI-ассистент на Demo Day Halyk Bank. Участник прошёл квиз о банковских продуктах.

Важные правила:
- Никогда не давай гарантий и обещаний. Используй формулировки: "возможно", "как правило", "стоит рассмотреть", "может быть полезно".
- Давай точные и взвешенные советы, а не маркетинговые заверения.
- Не преувеличивай возможности продуктов и не обещай конкретных результатов.

Данные участника:
- Тип клиентов: ${business_type === 'b2b' ? 'B2B/G (работает с бизнесом или государством)' : 'B2C (розничные клиенты)'}
- Отрасль: ${industry}
- Размер компании: ${sizeLabel[company_size] || company_size}
- Приоритет: ${priorityLabel[priority] || priority}
- Digital-готовность: ${digitalLabel[digital_level] || digital_level}${open_q6 ? `\n- Главная задача бизнеса: "${open_q6}"` : ''}${open_q7 ? `\n- О себе: "${open_q7}"` : ''}

Топ-3 продукта Halyk Bank по матрице:
${top3Lines}

Задача:
1. Для каждого из 3 продуктов напиши 1–2 предложения: почему именно этот продукт актуален для ЭТОГО конкретного человека с его задачами. Ссылайся на конкретные детали его ответов.
2. В поле "personal_insight" напиши персональное наблюдение о самом участнике и его бизнесе — без упоминания конкретных продуктов. Сделай акцент на его ситуации, возможностях роста и ключевом вызове. 2–3 предложения, вдохновляющий тон.${freeQuestionBlock}

Отвечай строго в JSON без markdown:
${jsonSchema}
Только JSON, без пояснений. На русском языке.`;

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: open_q8 ? 900 : 700,
          response_format: { type: 'json_object' },
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const parsed = JSON.parse(data.choices[0].message.content);
        aiProducts = parsed.products;
        personalInsight = parsed.personal_insight;
        aiAnswer = parsed.ai_answer || null;
        usedAI = true;
      }
    } catch (e) {
      console.warn('OpenAI call failed, using decision tree only:', e);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    top3,
    ai_products: aiProducts,
    ai_trend: aiTrend,
    personal_insight: personalInsight,
    ai_answer: aiAnswer,
    used_ai: usedAI,
  }), { status: 200, headers: CORS_HEADERS });
});
