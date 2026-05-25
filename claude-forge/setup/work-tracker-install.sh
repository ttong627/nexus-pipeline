#!/bin/bash
# work-tracker-install.sh
# Claude Code 업무 추적 시스템 설치 (다른 PC에서도 실행 가능)
# 사용: bash dotclaude/setup/work-tracker-install.sh
#       또는 install.sh에서 자동 호출

set -e

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
CLAUDE_DIR="$HOME/.claude"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "Work Tracker 설치"
echo "================="

# 0. 이미 설치 완료 확인 (빠른 스킵)
quick_check() {
    [ -d "$CLAUDE_DIR/work-log" ] && \
    [ -f "$CLAUDE_DIR/scripts/work-tracker-sync.sh" ] && \
    [ -f "$CLAUDE_DIR/hooks/work-tracker-prompt.sh" ] && \
    { [[ "$OSTYPE" != "darwin"* ]] || launchctl list 2>/dev/null | grep -q "work-tracker"; }
}

if quick_check; then
    # sync 스크립트 버전 비교 (업데이트 필요 시에만 재설치)
    if diff -q "$REPO_DIR/scripts/work-tracker-sync.sh" "$CLAUDE_DIR/scripts/work-tracker-sync.sh" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Work Tracker 이미 설치됨 (최신)"
        return 0 2>/dev/null || exit 0
    else
        echo -e "  ${YELLOW}!${NC} Work Tracker 업데이트 감지 — 재설치..."
    fi
fi

# 1. work-log 디렉토리 생성
setup_worklog_dir() {
    echo "  work-log 디렉토리 생성..."
    mkdir -p "$CLAUDE_DIR/work-log/.sessions"
    mkdir -p "$CLAUDE_DIR/work-log/archive"
    touch "$CLAUDE_DIR/work-log/buffer.jsonl"
    echo -e "  ${GREEN}✓${NC} ~/.claude/work-log/"
}

# 2. sync 스크립트 복사
install_sync_script() {
    echo "  sync 스크립트 설치..."
    local src="$REPO_DIR/scripts/work-tracker-sync.sh"
    local dst="$CLAUDE_DIR/scripts/work-tracker-sync.sh"

    if [ ! -f "$src" ]; then
        echo -e "  ${RED}✗${NC} work-tracker-sync.sh 소스 없음"
        return 1
    fi

    mkdir -p "$CLAUDE_DIR/scripts"
    cp "$src" "$dst"
    chmod +x "$dst"
    echo -e "  ${GREEN}✓${NC} ~/.claude/scripts/work-tracker-sync.sh"
}

# 3. LaunchAgent 설치 (macOS only)
install_launchagent() {
    if [[ "$OSTYPE" != "darwin"* ]]; then
        echo -e "  ${YELLOW}!${NC} macOS가 아님 — LaunchAgent 건너뜀 (cron 수동 설정 필요)"
        return 0
    fi

    echo "  LaunchAgent 설치..."
    local plist_name="com.claude.work-tracker-sync.plist"
    local dst="$LAUNCH_AGENTS/$plist_name"

    # 기존 LaunchAgent 언로드 (있으면)
    launchctl unload "$dst" 2>/dev/null || true

    # SUPABASE_ANON_KEY 확인
    local anon_key=""
    if [ -f "$CLAUDE_DIR/settings.json" ] && command -v python3 >/dev/null; then
        anon_key=$(python3 -c "
import json, sys
try:
    d = json.load(open('$CLAUDE_DIR/settings.json'))
    print(d.get('env', {}).get('SUPABASE_ANON_KEY', ''))
except: pass
" 2>/dev/null)
    fi

    if [ -z "$anon_key" ]; then
        echo -e "  ${YELLOW}!${NC} SUPABASE_ANON_KEY 미발견 — settings.json env 확인 필요"
        echo "  settings.json의 env에 SUPABASE_ANON_KEY를 추가한 뒤 이 스크립트를 다시 실행하세요."
        echo -e "  ${YELLOW}!${NC} LaunchAgent 설치 건너뜀 (나머지 설치는 정상 진행)"
        return 0
    fi

    # plist 생성 (경로를 현재 사용자 HOME으로 치환)
    mkdir -p "$LAUNCH_AGENTS"
    cat > "$dst" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.work-tracker-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>${HOME}/.claude/scripts/work-tracker-sync.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>SUPABASE_ANON_KEY</key>
        <string>${anon_key}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${HOME}/.claude/work-log/sync-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/.claude/work-log/sync-stderr.log</string>
</dict>
</plist>
PLIST

    # 로드
    launchctl load "$dst"
    echo -e "  ${GREEN}✓${NC} LaunchAgent 등록 (1분 주기)"
}

# 4. 검증
verify_install() {
    echo ""
    echo "  검증 중..."
    local errors=0

    # 훅 파일 확인 (심링크 통해 이미 존재해야 함)
    for hook in work-tracker-prompt.sh work-tracker-tool.sh work-tracker-stop.sh; do
        if [ -f "$CLAUDE_DIR/hooks/$hook" ] && [ -x "$CLAUDE_DIR/hooks/$hook" ]; then
            echo -e "  ${GREEN}✓${NC} hooks/$hook"
        else
            echo -e "  ${RED}✗${NC} hooks/$hook (없거나 실행권한 없음)"
            ((errors++))
        fi
    done

    # sync 스크립트
    if [ -f "$CLAUDE_DIR/scripts/work-tracker-sync.sh" ] && [ -x "$CLAUDE_DIR/scripts/work-tracker-sync.sh" ]; then
        echo -e "  ${GREEN}✓${NC} scripts/work-tracker-sync.sh"
    else
        echo -e "  ${RED}✗${NC} scripts/work-tracker-sync.sh"
        ((errors++))
    fi

    # work-log 디렉토리
    if [ -d "$CLAUDE_DIR/work-log" ]; then
        echo -e "  ${GREEN}✓${NC} work-log/"
    else
        echo -e "  ${RED}✗${NC} work-log/"
        ((errors++))
    fi

    # settings.json에 hooks 이벤트 확인
    if command -v python3 >/dev/null && [ -f "$CLAUDE_DIR/settings.json" ]; then
        local has_hooks=$(python3 -c "
import json
d = json.load(open('$CLAUDE_DIR/settings.json'))
hooks = d.get('hooks', {})
events = ['UserPromptSubmit', 'PostToolUse', 'Stop']
print('ok' if all(e in hooks for e in events) else 'missing')
" 2>/dev/null)
        if [ "$has_hooks" = "ok" ]; then
            echo -e "  ${GREEN}✓${NC} settings.json hooks (3개 이벤트)"
        else
            echo -e "  ${RED}✗${NC} settings.json hooks (UserPromptSubmit/PostToolUse/Stop 누락)"
            ((errors++))
        fi
    fi

    # LaunchAgent (macOS)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if launchctl list 2>/dev/null | grep -q "work-tracker"; then
            echo -e "  ${GREEN}✓${NC} LaunchAgent 실행 중"
        else
            echo -e "  ${YELLOW}!${NC} LaunchAgent 미실행"
        fi
    fi

    echo ""
    if [ $errors -eq 0 ]; then
        echo -e "${GREEN}Work Tracker 설치 완료!${NC}"
    else
        echo -e "${RED}${errors}개 항목 확인 필요${NC}"
    fi
    return $errors
}

# Main
setup_worklog_dir
install_sync_script
install_launchagent
verify_install
