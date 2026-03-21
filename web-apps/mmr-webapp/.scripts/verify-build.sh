#!/bin/bash
set -e

echo "🔍 Verifying build..."
echo ""

echo "📝 Running linter..."
npm run lint || { echo "❌ Linting failed"; exit 1; }

echo ""
echo "🔨 Building..."
npm run build || { echo "❌ Build failed"; exit 1; }

echo ""
echo "✅ Build verification passed!"
