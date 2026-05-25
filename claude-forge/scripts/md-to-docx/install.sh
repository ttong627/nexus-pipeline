#!/bin/bash
# MD to DOCX 변환기 설치 스크립트

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== MD to DOCX 변환기 설치 ==="
echo "설치 경로: $SCRIPT_DIR"
echo ""

# Python 버전 확인
if ! command -v python3 &> /dev/null; then
    echo "오류: python3이 설치되어 있지 않습니다."
    exit 1
fi

PYTHON_VERSION=$(python3 --version)
echo "Python: $PYTHON_VERSION"

# 가상환경 생성
echo ""
echo "가상환경 생성 중..."
cd "$SCRIPT_DIR"
python3 -m venv venv

# 가상환경 활성화 및 패키지 설치
echo "패키지 설치 중..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "=== 설치 완료 ==="
echo ""
echo "사용법:"
echo "  source ~/.claude/scripts/md-to-docx/venv/bin/activate"
echo "  python ~/.claude/scripts/md-to-docx/convert.py --help"
echo ""
echo "또는 Claude Code에서:"
echo "  /md-to-docx file.md"
