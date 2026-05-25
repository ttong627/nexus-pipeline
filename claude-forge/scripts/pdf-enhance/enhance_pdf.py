#!/usr/bin/env python3
"""
PDF Enhance - PDF post-processing
PyMuPDF(fitz)를 사용하여 PDF에 헤더/푸터/표지 추가

사용법:
    python enhance_pdf.py input.pdf                     # 기본 (헤더/푸터만)
    python enhance_pdf.py input.pdf -o output.pdf       # 출력 파일 지정
    python enhance_pdf.py input.pdf --cover "제목" "부제목"  # 표지 추가
    python enhance_pdf.py input.pdf --cover-only "제목" "부제목"  # 표지만 생성
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime

try:
    import fitz  # PyMuPDF
except ImportError:
    print("PyMuPDF가 설치되어 있지 않습니다.")
    print("설치: pip install PyMuPDF")
    sys.exit(1)


# 브랜드 컬러 (RGB 0-1 범위)
INDIGO = (99/255, 102/255, 241/255)
INDIGO_DARK = (79/255, 70/255, 229/255)
TEXT_PRIMARY = (31/255, 41/255, 55/255)
TEXT_SECONDARY = (107/255, 114/255, 128/255)
WHITE = (1, 1, 1)

# 폰트 검색 경로 (macOS / Linux)
FONT_SEARCH_PATHS = [
    Path.home() / "Library/Fonts",
    Path("/System/Library/Fonts"),
    Path("/Library/Fonts"),
    Path("/usr/share/fonts"),
    Path("/usr/local/share/fonts"),
    Path.home() / ".fonts",
    Path.home() / ".local/share/fonts",
]


def find_font(name: str) -> str:
    """폰트 파일을 시스템에서 동적으로 탐색"""
    for search_dir in FONT_SEARCH_PATHS:
        font_path = search_dir / name
        if font_path.exists():
            return str(font_path)
        if search_dir.exists():
            matches = list(search_dir.rglob(name))
            if matches:
                return str(matches[0])
    raise FileNotFoundError(f"폰트를 찾을 수 없습니다: {name}")


# Pretendard 폰트 경로 (동적 탐색)
try:
    FONT_REGULAR = find_font("Pretendard-Regular.otf")
    FONT_BOLD = find_font("Pretendard-Bold.otf")
    FONT_SEMIBOLD = find_font("Pretendard-SemiBold.otf")
except FileNotFoundError as e:
    print(f"WARNING: {e}")
    print("기본 폰트로 대체됩니다.")
    FONT_REGULAR = None
    FONT_BOLD = None
    FONT_SEMIBOLD = None

# 디자인 상수
HEADER_HEIGHT = 40
FOOTER_HEIGHT = 30
PAGE_MARGIN = 50


def load_fonts():
    """Pretendard 폰트 로드"""
    fonts = {}

    try:
        if FONT_REGULAR and FONT_BOLD and FONT_SEMIBOLD:
            fonts['regular'] = fitz.Font(fontfile=FONT_REGULAR)
            fonts['bold'] = fitz.Font(fontfile=FONT_BOLD)
            fonts['semibold'] = fitz.Font(fontfile=FONT_SEMIBOLD)
        else:
            raise FileNotFoundError("Pretendard 폰트 미발견")
    except Exception as e:
        print(f"폰트 로드 실패: {e}")
        print("기본 폰트를 사용합니다.")
        fonts['regular'] = fitz.Font("helv")
        fonts['bold'] = fitz.Font("hebo")
        fonts['semibold'] = fitz.Font("hebo")

    return fonts


def create_cover_page(title: str, subtitle: str = "", fonts: dict = None) -> fitz.Document:
    """프로페셔널 표지 생성"""
    if fonts is None:
        fonts = load_fonts()

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)  # A4 크기
    rect = page.rect

    # 배경: Indigo 그라데이션 효과 (단색으로 구현)
    page.draw_rect(rect, color=None, fill=INDIGO)

    # 상단 장식 라인
    top_line_rect = fitz.Rect(0, 80, rect.width, 82)
    page.draw_rect(top_line_rect, color=None, fill=WHITE)

    # Company 로고 텍스트 (상단)
    tw_logo = fitz.TextWriter(rect)
    tw_logo.append((PAGE_MARGIN, 140), "Your Organization", font=fonts['bold'], fontsize=48)
    tw_logo.write_text(page, color=WHITE)

    # Company subtitle (로고 아래)
    tw_company = fitz.TextWriter(rect)
    tw_company.append((PAGE_MARGIN, 175), "Your Organization", font=fonts['regular'], fontsize=18)
    tw_company.write_text(page, color=WHITE)

    # 중앙 구분선
    mid_y = 280
    mid_line_rect = fitz.Rect(PAGE_MARGIN, mid_y, rect.width - PAGE_MARGIN, mid_y + 2)
    page.draw_rect(mid_line_rect, color=None, fill=(1, 1, 1, 0.3))

    # 제목 (중앙)
    title_y = 380
    tw_title = fitz.TextWriter(rect)

    # 긴 제목 처리 (한 줄 최대 20자)
    if len(title) > 20:
        # 적절한 위치에서 줄바꿈
        mid = len(title) // 2
        # 공백 찾기
        space_pos = title.rfind(' ', 0, mid + 5)
        if space_pos == -1:
            space_pos = mid

        title_line1 = title[:space_pos].strip()
        title_line2 = title[space_pos:].strip()

        tw_title.append((PAGE_MARGIN, title_y), title_line1, font=fonts['bold'], fontsize=32)
        tw_title.append((PAGE_MARGIN, title_y + 45), title_line2, font=fonts['bold'], fontsize=32)
    else:
        tw_title.append((PAGE_MARGIN, title_y), title, font=fonts['bold'], fontsize=36)

    tw_title.write_text(page, color=WHITE)

    # 부제목
    if subtitle:
        subtitle_y = title_y + 100 if len(title) > 20 else title_y + 60
        tw_subtitle = fitz.TextWriter(rect)
        tw_subtitle.append((PAGE_MARGIN, subtitle_y), subtitle, font=fonts['regular'], fontsize=20)
        tw_subtitle.write_text(page, color=WHITE)

    # 하단 정보
    bottom_y = rect.height - 120

    # 제출일
    today = datetime.now().strftime("%Y년 %m월")
    tw_date = fitz.TextWriter(rect)
    tw_date.append((PAGE_MARGIN, bottom_y), f"제출일: {today}", font=fonts['regular'], fontsize=12)
    tw_date.write_text(page, color=WHITE)

    # 제출자
    tw_author = fitz.TextWriter(rect)
    tw_author.append((PAGE_MARGIN, bottom_y + 22), "Submitted by: Your Organization", font=fonts['regular'], fontsize=12)
    tw_author.write_text(page, color=WHITE)

    # 하단 장식 라인
    bottom_line_rect = fitz.Rect(0, rect.height - 40, rect.width, rect.height - 38)
    page.draw_rect(bottom_line_rect, color=None, fill=WHITE)

    return doc


def add_header_footer(
    input_path: str,
    output_path: str,
    skip_first_page: bool = True,
    header_text: str = "Your Organization",
    footer_url: str = "example.com"
):
    """PDF에 헤더와 푸터 추가"""
    fonts = load_fonts()
    doc = fitz.open(input_path)

    for page_num, page in enumerate(doc):
        rect = page.rect

        # 첫 페이지 스킵 옵션
        if skip_first_page and page_num == 0:
            continue

        # 헤더 배경 (Indigo)
        header_rect = fitz.Rect(0, 0, rect.width, HEADER_HEIGHT)
        page.draw_rect(header_rect, color=None, fill=INDIGO)

        # 헤더 텍스트: Company (굵게)
        tw_header = fitz.TextWriter(rect)
        tw_header.append((20, 26), "Company", font=fonts['bold'], fontsize=14)
        tw_header.write_text(page, color=WHITE)

        # 헤더 텍스트: Your Organization
        tw_company = fitz.TextWriter(rect)
        tw_company.append((58, 26), "Your Organization", font=fonts['regular'], fontsize=10)
        tw_company.write_text(page, color=WHITE)

        # 푸터 배경 (연한 회색)
        footer_rect = fitz.Rect(0, rect.height - FOOTER_HEIGHT, rect.width, rect.height)
        page.draw_rect(footer_rect, color=None, fill=(0.98, 0.98, 0.98))

        # 푸터: 페이지 번호 (중앙)
        page_text = f"{page_num + 1}"
        tw_page = fitz.TextWriter(rect)
        # 중앙 정렬을 위한 대략적 계산
        tw_page.append((rect.width / 2 - 5, rect.height - 12), page_text, font=fonts['regular'], fontsize=10)
        tw_page.write_text(page, color=TEXT_SECONDARY)

        # 푸터: URL (우측)
        tw_url = fitz.TextWriter(rect)
        tw_url.append((rect.width - 70, rect.height - 12), footer_url, font=fonts['regular'], fontsize=9)
        tw_url.write_text(page, color=INDIGO)

    doc.save(output_path)
    doc.close()

    return output_path


def enhance_pdf(
    input_path: str,
    output_path: str = None,
    add_cover: bool = False,
    cover_title: str = "",
    cover_subtitle: str = "",
    skip_header_first: bool = True
):
    """PDF 전체 개선"""
    input_file = Path(input_path)

    if output_path is None:
        output_path = str(input_file.with_stem(f"{input_file.stem}_enhanced"))

    fonts = load_fonts()

    # 표지 생성
    if add_cover and cover_title:
        cover_doc = create_cover_page(cover_title, cover_subtitle, fonts)

        # 원본 PDF 열기
        main_doc = fitz.open(input_path)

        # 표지 뒤에 본문 삽입
        cover_doc.insert_pdf(main_doc)

        # 임시 저장
        temp_path = str(input_file.with_stem(f"{input_file.stem}_temp"))
        cover_doc.save(temp_path)
        cover_doc.close()
        main_doc.close()

        # 헤더/푸터 추가 (표지 제외)
        add_header_footer(
            temp_path,
            output_path,
            skip_first_page=True,
            header_text="Your Organization",
            footer_url="example.com"
        )

        # 임시 파일 삭제
        Path(temp_path).unlink()
    else:
        # 헤더/푸터만 추가
        add_header_footer(
            input_path,
            output_path,
            skip_first_page=skip_header_first,
            header_text="Your Organization",
            footer_url="example.com"
        )

    return output_path


def main():
    parser = argparse.ArgumentParser(
        description='PDF post-processing (헤더/푸터/표지)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  %(prog)s input.pdf                          # 헤더/푸터 추가
  %(prog)s input.pdf -o output.pdf            # 출력 파일 지정
  %(prog)s input.pdf --cover "제안서 제목"       # 표지 + 헤더/푸터
  %(prog)s input.pdf --cover "제목" "부제목"     # 표지(부제목 포함)
  %(prog)s --cover-only "제목" -o cover.pdf    # 표지만 생성
        """
    )

    parser.add_argument('input', nargs='?', help='입력 PDF 파일')
    parser.add_argument('-o', '--output', help='출력 파일 경로')
    parser.add_argument('--cover', nargs='+', metavar=('TITLE', 'SUBTITLE'),
                        help='표지 추가 (제목 [부제목])')
    parser.add_argument('--cover-only', nargs='+', metavar=('TITLE', 'SUBTITLE'),
                        help='표지만 생성 (제목 [부제목])')
    parser.add_argument('--no-skip-first', action='store_true',
                        help='첫 페이지에도 헤더/푸터 추가')

    args = parser.parse_args()

    # 표지만 생성
    if args.cover_only:
        title = args.cover_only[0]
        subtitle = args.cover_only[1] if len(args.cover_only) > 1 else ""
        output = args.output or "cover.pdf"

        fonts = load_fonts()
        cover_doc = create_cover_page(title, subtitle, fonts)
        cover_doc.save(output)
        cover_doc.close()

        print(f"표지 생성 완료: {output}")
        return

    # 입력 파일 필수
    if not args.input:
        parser.error("입력 PDF 파일을 지정해주세요.")

    if not Path(args.input).exists():
        print(f"파일을 찾을 수 없습니다: {args.input}")
        sys.exit(1)

    # PDF 처리
    add_cover = bool(args.cover)
    cover_title = args.cover[0] if args.cover else ""
    cover_subtitle = args.cover[1] if args.cover and len(args.cover) > 1 else ""

    output_path = enhance_pdf(
        args.input,
        args.output,
        add_cover=add_cover,
        cover_title=cover_title,
        cover_subtitle=cover_subtitle,
        skip_header_first=not args.no_skip_first
    )

    print(f"PDF 처리 완료: {output_path}")


if __name__ == '__main__':
    main()
