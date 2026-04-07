#!/bin/bash
# Halyk AI Quiz — Configuration Script
# Patches quiz.html and dashboard.html with your Supabase credentials
#
# Usage: ./scripts/configure.sh <SUPABASE_URL> <ANON_KEY>

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo ""
  echo "  Halyk AI Quiz — Configurator"
  echo "  ============================="
  echo ""
  echo "  Usage: ./scripts/configure.sh <SUPABASE_URL> <ANON_KEY>"
  echo ""
  echo "  Example:"
  echo "    ./scripts/configure.sh https://abcdefg.supabase.co eyJhbGciOi..."
  echo ""
  echo "  Где взять:"
  echo "    Supabase Dashboard → Settings → API"
  echo "    • Project URL  → первый аргумент"
  echo "    • anon public  → второй аргумент"
  echo ""
  exit 1
fi

SUPABASE_URL="$1"
ANON_KEY="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Validate URL format
if [[ ! "$SUPABASE_URL" =~ ^https://.*\.supabase\.co$ ]]; then
  echo "WARNING: URL не похож на Supabase URL (ожидается https://xxx.supabase.co)"
  read -p "Продолжить? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi
fi

echo ""
echo "Настраиваю проект:"
echo "  Supabase URL:      $SUPABASE_URL"
echo "  Edge Function URL: ${SUPABASE_URL}/functions/v1/submit-quiz"
echo "  Anon Key:          ${ANON_KEY:0:20}..."
echo ""

# Patch quiz.html
QUIZ="$PROJECT_DIR/src/quiz.html"
if [ -f "$QUIZ" ]; then
  sed -i.bak "s|YOUR_SUPABASE_URL/functions/v1/submit-quiz|${SUPABASE_URL}/functions/v1/submit-quiz|g" "$QUIZ"
  rm -f "$QUIZ.bak"
  echo "  ✓ quiz.html — готово"
else
  echo "  ✗ quiz.html не найден: $QUIZ"
fi

# Patch dashboard.html
DASH="$PROJECT_DIR/src/dashboard.html"
if [ -f "$DASH" ]; then
  sed -i.bak "s|YOUR_SUPABASE_URL|${SUPABASE_URL}|g" "$DASH"
  sed -i.bak "s|YOUR_ANON_KEY|${ANON_KEY}|g" "$DASH"
  rm -f "$DASH.bak"
  echo "  ✓ dashboard.html — готово"
else
  echo "  ✗ dashboard.html не найден: $DASH"
fi

echo ""
echo "Готово! Следующие шаги:"
echo ""
echo "  1. Создать таблицы в Supabase:"
echo "     → SQL Editor → вставить содержимое scripts/supabase-setup.sql → Run"
echo ""
echo "  2. Задеплоить Edge Function:"
echo "     supabase link --project-ref $(echo "$SUPABASE_URL" | sed 's|https://||;s|\.supabase\.co||')"
echo "     supabase functions deploy submit-quiz --no-verify-jwt"
echo ""
echo "  3. Захостить папку src/ на Vercel/Netlify/VPS"
echo ""
