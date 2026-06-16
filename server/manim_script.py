"""
PortalKit Manim Explainer Video Generator
Run: python3 manim_script.py --script "sentence1|sentence2|..." --output /tmp/out.mp4
"""
import sys
import os
import argparse
import shutil

os.environ['MANIM_DISABLE_CACHING'] = '1'

from manim import *

config.pixel_height = 1920
config.pixel_width = 1080
config.frame_rate = 30
config.background_color = "#0D1B2A"
config.disable_caching = True

GOLD = "#C9A84C"
NAVY = "#0D1B2A"
WHITE_TEXT = "#FFFFFF"


class PortalKitScene(Scene):
    def __init__(self, sentences, **kwargs):
        super().__init__(**kwargs)
        self.sentences = sentences

    def construct(self):
        brand = Text("PORTALKIT", color=GOLD, font_size=44, weight=BOLD)
        brand.to_edge(UP, buff=0.8)
        brand_line = Line(brand.get_left(), brand.get_right(), color=GOLD, stroke_width=2)
        brand_line.next_to(brand, DOWN, buff=0.1)

        self.play(Write(brand, run_time=0.8), Create(brand_line, run_time=0.6))

        prev_group = None

        for i, sentence in enumerate(self.sentences):
            main_text = Text(sentence, color=WHITE_TEXT, font_size=40, line_spacing=1.4)
            main_text.set_max_width(8)
            main_text.move_to(ORIGIN + DOWN * 0.3)

            underline = Line(
                main_text.get_left() + DOWN * 0.3,
                main_text.get_right() + DOWN * 0.3,
                color=GOLD, stroke_width=1.5
            )

            if prev_group:
                self.play(FadeOut(prev_group, shift=UP * 0.4), run_time=0.3)

            self.play(AddTextLetterByLetter(main_text, run_time=min(1.5, len(sentence) * 0.04)))
            self.play(Create(underline, run_time=0.4))

            word_count = len(sentence.split())
            hold = max(1.8, word_count / 2.2)
            self.wait(hold)

            prev_group = VGroup(main_text, underline)

        if prev_group:
            self.play(FadeOut(prev_group, run_time=0.3))

        cta_rect = RoundedRectangle(
            corner_radius=0.15, width=7.5, height=1.2,
            color=GOLD, fill_color=GOLD, fill_opacity=1
        )
        cta_text = Text("getportalkit.com", color=NAVY, font_size=34, weight=BOLD)
        cta = VGroup(cta_rect, cta_text)
        cta.move_to(ORIGIN + DOWN * 2.5)

        self.play(GrowFromCenter(cta_rect, run_time=0.5), Write(cta_text, run_time=0.5))
        self.wait(2.5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--script', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()

    sentences = [s.strip() for s in args.script.split('|') if s.strip()]
    if not sentences:
        print('ERROR: No sentences provided', file=sys.stderr)
        sys.exit(1)

    output_dir = os.path.dirname(args.output)
    output_name = os.path.splitext(os.path.basename(args.output))[0]
    os.makedirs(output_dir, exist_ok=True)

    config.output_file = output_name
    config.media_dir = output_dir

    scene = PortalKitScene(sentences)
    scene.render()

    # Manim nests output under media_dir/videos/<name>/1080p30/
    rendered = os.path.join(output_dir, 'videos', output_name, '1080p30', output_name + '.mp4')
    if os.path.exists(rendered) and rendered != args.output:
        shutil.move(rendered, args.output)
        print(f'SUCCESS: {args.output}')
    elif os.path.exists(args.output):
        print(f'SUCCESS: {args.output}')
    else:
        print(f'ERROR: output not found at {args.output}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
