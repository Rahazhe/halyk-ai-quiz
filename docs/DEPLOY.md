# Halyk AI Quiz — Инструкция по деплою

## Что это

Интерактивный квиз для Demo Day: 7 вопросов → AI-профиль + рекомендация продукта.
Данные сохраняются в Supabase, лайв-дашборд показывает статистику в реальном времени.

## Структура проекта

```
src/
  quiz.html         — Квиз (раздаётся по QR участникам)
  dashboard.html     — Лайв-дашборд для стенда (TV/ноутбук)

supabase/
  migrations/        — SQL-схема базы данных
  functions/         — Edge Function (серверная валидация)

scripts/
  configure.sh       — Скрипт настройки URL
  supabase-setup.sql — SQL (копия, для ручного запуска)
```

## Деплой за 15 минут

### Шаг 1: Создать проект в Supabase (5 мин)

1. Зайти на [supabase.com](https://supabase.com) → New Project
2. Регион: **EU Central (Frankfurt)** — ближе к Казахстану
3. Придумать Database Password → сохранить
4. Дождаться создания (~2 мин)
5. Запомнить из Settings → API:
   - **Project URL** (пример: `https://abcdefg.supabase.co`)
   - **anon public key** (длинная строка `eyJhbG...`)
   - **service_role key** (секретная! не шарить)

### Шаг 2: Создать таблицы (2 мин)

**Вариант А — через SQL Editor (простой):**
1. Supabase Dashboard → SQL Editor → New Query
2. Скопировать содержимое файла `scripts/supabase-setup.sql`
3. Нажать Run

**Вариант Б — через CLI:**
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### Шаг 3: Задеплоить Edge Function (3 мин)

```bash
# Если ещё не установлен Supabase CLI:
npm install -g supabase

# Привязать к проекту (project ref из URL: https://abcdefg.supabase.co → abcdefg)
supabase link --project-ref YOUR_PROJECT_REF

# Деплой функции
supabase functions deploy submit-quiz --no-verify-jwt
```

`--no-verify-jwt` нужен, потому что квиз вызывает функцию без авторизации (публичный киоск).

### Шаг 4: Настроить URL в HTML файлах (2 мин)

**Автоматически (рекомендуется):**
```bash
chmod +x scripts/configure.sh
./scripts/configure.sh https://abcdefg.supabase.co eyJhbGciOiJIUzI1NiIs...
```
Скрипт принимает 2 аргумента: **Project URL** и **anon public key** из Шага 1.

**Вручную:**
1. Открыть `src/quiz.html` → найти `YOUR_SUPABASE_URL/functions/v1/submit-quiz` → заменить `YOUR_SUPABASE_URL` на реальный URL
2. Открыть `src/dashboard.html` → заменить `YOUR_SUPABASE_URL` и `YOUR_ANON_KEY` на реальные значения

### Шаг 5: Захостить HTML (3 мин)

**Вариант А — Vercel (рекомендуется):**
1. Зайти на [vercel.com](https://vercel.com) → New Project
2. Drag & drop папку `src/`
3. Получить URL типа `halyk-quiz.vercel.app`

**Вариант Б — Netlify:**
1. [app.netlify.com](https://app.netlify.com) → Add new site → Deploy manually
2. Drag & drop папку `src/`

**Вариант В — GitHub Pages:**
```bash
git push  # загрузить код на GitHub
# Settings → Pages → Source: main branch, /src folder
```

**Вариант Г — Любой VPS:**
```bash
scp src/* user@server:/var/www/quiz/
```

### Шаг 6: QR-код (1 мин)

Сгенерировать QR на URL квиза: любой QR-генератор, например [qr.io](https://qr.io).

## Проверка работоспособности

1. Открыть квиз → пройти анонимно → должен показать результат
2. Открыть квиз → заполнить имя + отдел → пройти → результат
3. Открыть дашборд → должны появиться данные с квиза
4. Пройти ещё раз → дашборд обновится автоматически

## Режим без Supabase (демо)

Если Supabase не настроен, оба файла работают в демо-режиме:
- **Квиз** — показывает результат, но не сохраняет данные
- **Дашборд** — показывает фейковые данные для проверки UI

## Безопасность

- Anon key в dashboard.html **безопасен** — он может только читать агрегированные views (quiz_stats, quiz_feed), не сырые данные
- Таблица quiz_sessions защищена RLS — прямой доступ невозможен
- Все данные проходят через Edge Function: валидация, rate limit (1 запрос/IP/60 сек), серверный пересчёт scores
- XSS защита: все пользовательские данные выводятся через textContent
- PII: имя/отдел опциональны, требуют согласия на обработку ПД

## Файлы

| Файл | Зачем |
|------|-------|
| `src/quiz.html` | Квиз — раздать по QR |
| `src/dashboard.html` | Дашборд — на TV стенда |
| `scripts/supabase-setup.sql` | SQL — запустить в Supabase |
| `scripts/configure.sh` | Автонастройка URL |
| `supabase/functions/submit-quiz/index.ts` | Edge Function — деплоить через CLI |
| `supabase/migrations/20260406_init.sql` | SQL миграция (для CLI) |
