"""Draws the sample item photos used by scripts/seed.mjs (SVG -> JPEG via headless Chrome).

Run once: python3 scripts/seed-photos/make.py   (writes scripts/seed-photos/*.jpg)
"""
import os, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

# A soft "photo on a surface" backdrop shared by every item.
def scene(surface, item, light='#ffffff'):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<defs>
  <radialGradient id="light" cx="35%" cy="25%" r="85%"><stop offset="0" stop-color="{light}" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></radialGradient>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dx="10" dy="16"/><feComponentTransfer><feFuncA type="linear" slope=".35"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .08 0"/></filter>
  <linearGradient id="metal" x1="0" x2="1"><stop offset="0" stop-color="#8b97a3"/><stop offset=".45" stop-color="#e9eef2"/><stop offset="1" stop-color="#6f7a85"/></linearGradient>
</defs>
<rect width="800" height="600" fill="{surface}"/>
<rect width="800" height="600" filter="url(#grain)"/>
<g filter="url(#shadow)">{item}</g>
<rect width="800" height="600" fill="url(#light)"/>
</svg>'''

WOOD = '#b98a5e'
DESK = '#d9d4c7'
TILE = '#cfd6d8'
BENCH = '#7f8f86'

ITEMS = {
  'keys-green-tag': (DESK, '''
    <circle cx="330" cy="250" r="62" fill="none" stroke="url(#metal)" stroke-width="12"/>
    <g transform="rotate(-25 330 250)"><path d="M330 312 l0 150 l22 0 l0 -14 l-12 0 l0 -10 l14 0 l0 -14 l-14 0 l0 -112z" fill="#c9a44a" stroke="#8a6d25" stroke-width="3"/><circle cx="341" cy="300" r="34" fill="#d8b456" stroke="#8a6d25" stroke-width="4"/><circle cx="341" cy="300" r="9" fill="{s}"/></g>
    <g transform="rotate(20 330 250)"><path d="M300 312 l0 140 l20 0 l0 -12 l-10 0 l0 -10 l12 0 l0 -12 l-12 0 l0 -106z" fill="url(#metal)" stroke="#5c6670" stroke-width="3"/><rect x="282" y="282" width="56" height="44" rx="12" fill="url(#metal)" stroke="#5c6670" stroke-width="3"/></g>
    <g transform="rotate(-8 470 230)"><rect x="390" y="190" width="170" height="86" rx="14" fill="#2f9e5b" stroke="#1d6b3c" stroke-width="4"/><circle cx="412" cy="233" r="12" fill="{s}"/><text x="485" y="244" font-family="Arial" font-weight="700" font-size="30" fill="#e8fff0" text-anchor="middle">ROOM 12</text></g>
    <line x1="392" y1="233" x2="352" y2="232" stroke="url(#metal)" stroke-width="8"/>'''.replace('{s}', DESK)),
  'blue-steel-bottle': (WOOD, '''
    <g transform="rotate(-12 400 300)">
      <rect x="330" y="150" width="140" height="330" rx="46" fill="#1f4f8f"/><rect x="345" y="160" width="26" height="300" rx="13" fill="#6f9fe0" opacity=".55"/>
      <rect x="350" y="105" width="100" height="62" rx="16" fill="url(#metal)" stroke="#555" stroke-width="3"/><rect x="372" y="88" width="56" height="26" rx="10" fill="#3a3f45"/>
      <g transform="translate(372 300)"><path d="M0 40 l28 -40 l18 24 l12 -14 l24 30z" fill="#fff"/><circle cx="64" cy="8" r="7" fill="#fff"/></g>
    </g>'''),
  'white-earbuds-case': (DESK, '''
    <rect x="290" y="210" width="220" height="180" rx="80" fill="#f7f7f5" stroke="#d2d2cc" stroke-width="4"/>
    <path d="M292 290 h216" stroke="#c9c9c2" stroke-width="4"/><rect x="388" y="318" width="24" height="8" rx="4" fill="#9cd3a0"/>
    <path d="M330 250 q40 -20 90 8" stroke="#b9b9b2" stroke-width="3" fill="none"/>
    <g transform="translate(540 300) rotate(30)"><ellipse cx="0" cy="0" rx="28" ry="34" fill="#fbfbf9" stroke="#d2d2cc" stroke-width="3"/><rect x="-10" y="20" width="20" height="70" rx="10" fill="#fbfbf9" stroke="#d2d2cc" stroke-width="3"/></g>'''),
  'student-id-card': (TILE, '''
    <g transform="rotate(-6 400 300)">
      <rect x="250" y="190" width="300" height="200" rx="16" fill="#fdfdfd" stroke="#c4cbd2" stroke-width="3"/>
      <rect x="250" y="190" width="300" height="52" rx="16" fill="#8b1d2c"/><rect x="250" y="226" width="300" height="16" fill="#8b1d2c"/>
      <text x="400" y="225" font-family="Arial" font-weight="700" font-size="22" fill="#fff" text-anchor="middle">STUDENT IDENTITY CARD</text>
      <rect x="272" y="262" width="80" height="100" rx="6" fill="#d6dde4"/><circle cx="312" cy="296" r="20" fill="#9aa6b2"/><path d="M282 352 q30 -40 60 0z" fill="#9aa6b2"/>
      <rect x="370" y="268" width="150" height="12" rx="6" fill="#4a525a"/><rect x="370" y="292" width="110" height="10" rx="5" fill="#9aa1a8"/><rect x="370" y="312" width="130" height="10" rx="5" fill="#9aa1a8"/>
      <g fill="#222">''' + ''.join(f'<rect x="{370+i*6}" y="338" width="{2 + (i*7)%3}" height="30"/>' for i in range(24)) + '''</g>
    </g>'''),
  'black-calculator': (DESK, '''
    <g transform="rotate(8 400 300)">
      <rect x="300" y="120" width="200" height="340" rx="18" fill="#26292d"/><rect x="322" y="146" width="156" height="62" rx="6" fill="#9fb39a"/>
      <text x="468" y="190" font-family="Courier New" font-weight="700" font-size="34" fill="#2c3a2a" text-anchor="end">42.195</text>
      <text x="322" y="232" font-family="Arial" font-weight="700" font-size="14" fill="#c9ced3">CASIO  fx-991</text>''' +
      ''.join(f'<rect x="{322 + c*40}" y="{250 + r*40}" width="30" height="28" rx="6" fill="{"#e07a3c" if (c==3 and r>2) else "#4a4f55"}"/>' for r in range(5) for c in range(4)) + '''
    </g>'''),
  'black-umbrella': (TILE, '''
    <g transform="rotate(-30 400 300)">
      <path d="M260 300 q140 -60 280 0 q-20 30 -50 22 q-25 28 -60 14 q-30 26 -60 6 q-35 22 -62 0 q-30 10 -48 -42z" fill="#1d1f22"/>
      <path d="M300 296 q100 -40 200 0" stroke="#3a3d42" stroke-width="4" fill="none"/>
      <rect x="395" y="310" width="10" height="170" fill="#555a60"/><path d="M400 476 q0 40 -36 40 q-24 0 -26 -22" stroke="#7a4a26" stroke-width="16" fill="none" stroke-linecap="round"/>
    </g>'''),
  'grey-hoodie': (BENCH, '''
    <path d="M300 170 q100 -40 200 0 l90 70 l-40 70 l-50 -30 l0 200 l-200 0 l0 -200 l-50 30 l-40 -70z" fill="#8d9298"/>
    <path d="M350 160 q50 60 100 0" stroke="#6f747a" stroke-width="10" fill="none"/>
    <path d="M400 190 l0 290" stroke="#6f747a" stroke-width="4"/><rect x="340" y="380" width="120" height="50" rx="10" fill="#7d8288"/>
    <line x1="385" y1="200" x2="378" y2="260" stroke="#e8e8e8" stroke-width="4"/><line x1="415" y1="200" x2="422" y2="260" stroke="#e8e8e8" stroke-width="4"/>'''),
  'physics-notebook': (WOOD, '''
    <g transform="rotate(-10 400 300)">
      <rect x="270" y="150" width="260" height="320" rx="8" fill="#2e6fb5"/><rect x="270" y="150" width="26" height="320" fill="#24588f"/>''' +
      ''.join(f'<circle cx="283" cy="{170+i*22}" r="7" fill="none" stroke="url(#metal)" stroke-width="4"/>' for i in range(14)) + '''
      <rect x="330" y="200" width="160" height="70" rx="6" fill="#fff"/><text x="410" y="232" font-family="Arial" font-weight="700" font-size="22" fill="#24588f" text-anchor="middle">PHYSICS</text>
      <text x="410" y="258" font-family="Arial" font-size="14" fill="#555" text-anchor="middle">Sem 3 · Notes</text>
    </g>'''),
  'black-backpack': (TILE, '''
    <path d="M300 200 q0 -70 100 -70 q100 0 100 70 l10 260 q0 30 -30 30 l-160 0 q-30 0 -30 -30z" fill="#2b2f34"/>
    <path d="M360 140 q40 -50 80 0" stroke="#1b1e22" stroke-width="14" fill="none"/>
    <rect x="330" y="330" width="140" height="110" rx="20" fill="#363b41" stroke="#1b1e22" stroke-width="4"/><path d="M340 352 h120" stroke="#a7adb3" stroke-width="3"/>
    <rect x="392" y="200" width="16" height="40" rx="4" fill="#e0b13a"/>'''),
  'silver-watch': (DESK, '''
    <rect x="370" y="120" width="60" height="360" rx="10" fill="#3b3f44"/>''' + ''.join(f'<rect x="372" y="{130+i*22}" width="56" height="3" fill="#2a2d31"/>' for i in range(16)) + '''
    <circle cx="400" cy="300" r="88" fill="url(#metal)" stroke="#5c6670" stroke-width="5"/><circle cx="400" cy="300" r="70" fill="#f4f6f8"/>
    <line x1="400" y1="300" x2="400" y2="250" stroke="#222" stroke-width="6" stroke-linecap="round"/><line x1="400" y1="300" x2="440" y2="318" stroke="#222" stroke-width="4" stroke-linecap="round"/>''' +
    ''.join(f'<rect x="398" y="236" width="4" height="10" fill="#555" transform="rotate({i*30} 400 300)"/>' for i in range(12))),
  'laptop-charger': (WOOD, '''
    <rect x="300" y="250" width="150" height="90" rx="14" fill="#f2f2f0" stroke="#cfcfc8" stroke-width="4"/>
    <path d="M450 296 q120 0 120 -80 q0 -60 -60 -60 q-80 0 -60 80 q20 80 -80 140 q-90 50 -140 10" stroke="#f2f2f0" stroke-width="10" fill="none"/>
    <rect x="190" y="370" width="40" height="26" rx="5" fill="#d9d9d4"/>'''),
}

def main():
    with tempfile.TemporaryDirectory() as tmp:
        for name, (surface, item) in ITEMS.items():
            svg = os.path.join(tmp, f'{name}.svg')
            png = os.path.join(tmp, f'{name}.png')
            with open(svg, 'w') as handle:
                handle.write(scene(surface, item))
            subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=800,600',
                            f'--screenshot={png}', f'file://{svg}'], check=True, capture_output=True)
            subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', png, '--out',
                            os.path.join(HERE, f'{name}.jpg')], check=True, capture_output=True)
            print('wrote', name)

if __name__ == '__main__':
    main()
