interface DemoSceneProps {
  running: boolean
}

/** An original illustration, deliberately labelled as a simulation. No game assets. */
export function DemoScene({ running }: DemoSceneProps) {
  const backgroundTrees = [42, 174, 353, 535, 752, 917, 1132, 1250]
  const grass = Array.from({ length: 72 }, (_, i) => ({ x: i * 19, h: 5 + ((i * 17) % 13) }))

  return (
    <div className={`demo-scene ${running ? 'is-playing' : 'is-paused'}`} aria-label="실제 게임 영상이 아닌 테스트용 숲 일러스트">
      <svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet" role="img" aria-label="달빛 숲 테스트 화면">
        <defs>
          <linearGradient id="forest-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#122c32" />
            <stop offset=".56" stopColor="#315344" />
            <stop offset="1" stopColor="#132a2b" />
          </linearGradient>
          <linearGradient id="forest-trunk" x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="#162b2b" /><stop offset=".6" stopColor="#233b35" /><stop offset="1" stopColor="#13282a" />
          </linearGradient>
          <linearGradient id="forest-ground" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#506042" /><stop offset=".16" stopColor="#2a3c32" /><stop offset="1" stopColor="#18282a" />
          </linearGradient>
          <linearGradient id="forest-rune" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#b1bdff" /><stop offset="1" stopColor="#8971e6" />
          </linearGradient>
          <radialGradient id="forest-moon"><stop stopColor="#d6e4b8" stopOpacity=".24" /><stop offset="1" stopColor="#d6e4b8" stopOpacity="0" /></radialGradient>
          <radialGradient id="forest-portal"><stop stopColor="#97e8c5" stopOpacity=".6" /><stop offset=".6" stopColor="#65c6a5" stopOpacity=".2" /><stop offset="1" stopColor="#65c6a5" stopOpacity="0" /></radialGradient>
          <pattern id="forest-stone" width="64" height="40" patternUnits="userSpaceOnUse">
            <path d="M0 1h64M0 39h64M30 0v20M0 20h64M10 20v20M52 20v20" stroke="#152827" strokeWidth="3" opacity=".45" />
          </pattern>
          <filter id="forest-glow"><feGaussianBlur stdDeviation="5" /></filter>
        </defs>

        <path fill="url(#forest-sky)" d="M0 0h1280v720H0z" />
        <circle cx="811" cy="132" r="285" fill="url(#forest-moon)" />
        <circle cx="811" cy="132" r="34" fill="#c2d3af" opacity=".45" />
        <circle cx="824" cy="123" r="32" fill="#2d4a40" />
        <path d="M672 0 437 511h80L769 0zm122 0L700 423h32L851 0z" fill="#cde5bc" opacity=".035" />
        <g fill="#1b3c38" opacity=".7">
          {backgroundTrees.map((x, i) => <g key={x} transform={`translate(${x} ${30 + (i % 3) * 38})`}>
            <path d="m0 0-13 550h62L35 0z" />
            <path d="m18 190-100-118 16-7 90 80 99-104 11 12-99 144z" />
            <path d="m18 300-80-76 9-11 84 51 94-68 10 16-98 108z" />
            <ellipse cx="4" cy="45" rx="120" ry="64" /><ellipse cx="-72" cy="83" rx="97" ry="45" />
          </g>)}
        </g>
        <g opacity=".35" fill="#5b7852">
          <ellipse cx="192" cy="465" rx="280" ry="23" /><ellipse cx="925" cy="489" rx="320" ry="30" />
        </g>

        {/* Foreground tree frames the playable area. */}
        <path d="M60 0h91l-4 210-26 267 30 115H-7l58-172z" fill="url(#forest-trunk)" />
        <path d="m98 144-64-32L0 71v45l30 24 62 52zm32 77 78-61 60-94-17-7-67 74-53 30z" fill="#233a32" />
        <path d="m103 0-8 157-20 237m42-359-1 202 15 165" fill="none" stroke="#416047" strokeWidth="5" opacity=".27" />
        <path d="m1181 0 25 265-27 259 76 80h25V0z" fill="url(#forest-trunk)" />
        <path d="m1221 185-99-67-32-80-14 6 19 97 119 104z" fill="#1c302c" />
        <g fill="#243f33">
          <ellipse cx="55" cy="20" rx="204" ry="86" /><ellipse cx="233" cy="-5" rx="155" ry="60" />
          <ellipse cx="1136" cy="7" rx="223" ry="72" /><ellipse cx="1258" cy="73" rx="169" ry="86" />
        </g>
        <g fill="#3a563d" opacity=".55">
          <ellipse cx="53" cy="80" rx="90" ry="17" /><ellipse cx="189" cy="34" rx="78" ry="19" />
          <ellipse cx="1113" cy="36" rx="91" ry="17" /><ellipse cx="1254" cy="137" rx="64" ry="18" />
        </g>
        <g stroke="#47734f" strokeWidth="3" fill="none" opacity=".7">
          <path d="M294 0v122q-8 28 7 52t-2 42" /><path d="M987 0v157q-7 33 8 57" />
        </g>
        <g fill="#608358" opacity=".8"><ellipse cx="294" cy="106" rx="9" ry="4" transform="rotate(35 294 106)" /><ellipse cx="301" cy="151" rx="9" ry="4" transform="rotate(-35 301 151)" /><ellipse cx="986" cy="135" rx="9" ry="4" transform="rotate(35 986 135)" /></g>

        {/* Floating platforms. */}
        <path d="M198 361h236v30l-19 14H223l-25-18z" fill="#293d34" />
        <path d="M196 360h241v13H196z" fill="#597349" /><path d="M202 361h227v5H202z" fill="#78905a" />
        <path d="M850 318h252v27l-24 19H871l-21-20z" fill="#293d34" />
        <path d="M846 315h260v14H846z" fill="#597349" /><path d="M853 316h245v5H853z" fill="#78905a" />
        <g fill="#4b6844"><path d="m218 361 6-17 6 17 10-25 4 25zm173 0 5-13 5 13 9-18 4 18zm489-46 7-18 5 18 8-23 4 23zm169 0 6-13 7 13 9-22 3 22z" /></g>
        <path d="M0 566q120-19 258-4t271-1 274 4 265-5 212 3v157H0z" fill="url(#forest-ground)" />
        <path d="M0 586h1280v134H0z" fill="url(#forest-stone)" opacity=".65" />
        <path d="M0 565q120-19 258-4t271-1 274 4 265-5 212 3v12q-120-18-212-3t-265 5-274-4-271 1T0 577z" fill="#5f784a" />
        <g stroke="#70864e" strokeWidth="3">{grass.map(({x,h}) => <path key={x} d={`M${x} 568l3-${h} 4 ${h-3} 5-${h+2}`} />)}</g>
        <g fill="#71804d"><ellipse cx="140" cy="581" rx="28" ry="5" /><ellipse cx="922" cy="582" rx="35" ry="6" /><ellipse cx="389" cy="578" rx="19" ry="4" /></g>

        {/* Rune and portal are decorative demo fixtures. */}
        <g className="demo-rune">
          <ellipse cx="313" cy="341" rx="34" ry="10" fill="#151f32" opacity=".4" />
          <path d="m313 276 25 35-25 35-25-35z" fill="#9e93dd" opacity=".13" filter="url(#forest-glow)" />
          <path d="m313 281 20 29-20 29-20-29z" fill="#344452" stroke="#aaa1e4" strokeWidth="3" />
          <path d="m313 291 10 16-11 10 5 12m-16-21 11 9-4 13" fill="none" stroke="url(#forest-rune)" strokeWidth="4" />
          <path d="m286 282 4 6m51 2-4 5m-22-27v7" stroke="#bbb3f1" strokeWidth="2" />
        </g>
        <g className="demo-portal"><ellipse cx="1080" cy="505" rx="68" ry="81" fill="url(#forest-portal)" /><ellipse cx="1080" cy="511" rx="28" ry="45" fill="none" stroke="#90dfb7" strokeWidth="3" opacity=".55" /><ellipse cx="1080" cy="511" rx="22" ry="37" fill="none" stroke="#c1ead1" strokeWidth="1" opacity=".55" /></g>
        <path d="M1051 558h58l-8-10h-43z" fill="#7b8f76" />

        {/* Friendly mushroom creatures. */}
        {[403, 868].map((x, index) => <g key={x} className={`demo-monster monster-${index}`} transform={`translate(${x} 531)`}>
          <ellipse cx="0" cy="31" rx="28" ry="5" fill="#142725" opacity=".6" />
          <path d="M-14 9q-4 23 4 23H9q8-1 4-23" fill="#d0cba0" />
          <path d="M-28 10q0-32 28-32T28 10q-27 10-56 0" fill={index ? '#8e8d66' : '#b58e65'} stroke="#655e49" strokeWidth="2" />
          <ellipse cx="-11" cy="-9" rx="5" ry="4" fill="#d6c69a" opacity=".8" /><ellipse cx="9" cy="-11" rx="7" ry="5" fill="#d6c69a" opacity=".8" />
          <path d="M-5 17v4m12-4v4" stroke="#3d4334" strokeWidth="3" />
        </g>)}

        {/* Little adventurer. */}
        <g className="demo-hero" transform="translate(629 496)">
          <ellipse cx="0" cy="65" rx="26" ry="6" fill="#112621" opacity=".7" />
          <path d="m-12 42-3 20h11l4-15 4 15h12l-5-22z" fill="#253b42" />
          <path d="M-19 27-14 48h29l5-21-20-7z" fill="#6a8295" /><path d="M-5 25h10v24H-5z" fill="#a1b5ba" />
          <path d="m-19 29-11 16 6 5 12-14m31-7 11 16-6 5-12-14" fill="#ddc6a2" />
          <path d="M-14 4h28v22l-14 8-14-8z" fill="#e0c8a3" />
          <path d="M-18 2v18l9-8 6 4L3 5l9 11 6 2V0l-15-10-15 3z" fill="#514a45" />
          <path d="m-23 0 8-9 4-20 25 6 8 23z" fill="#6d8583" /><path d="m-11-27 5-11 20 14z" fill="#a6b7a1" /><path d="M-24 0h46v6h-46z" fill="#b6c3aa" />
          <path d="M-6 19v3m13-3v3" stroke="#37433d" strokeWidth="2" />
          <path d="m28 44 14-40m-6 9 9-9m-4 1-2-10" stroke="#abac93" strokeWidth="4" /><circle cx="43" cy="1" r="5" fill="#a6d7bb" />
        </g>
        <g fontFamily="sans-serif" textAnchor="middle"><rect x="590" y="579" width="79" height="21" rx="5" fill="#152a27" fillOpacity=".8" /><text x="629" y="594" fontSize="12" fill="#cdd9bf">MapleMate</text></g>

        {/* Fireflies. */}
        <g className="demo-fireflies" fill="#d1df9c"><circle cx="239" cy="263" r="2" /><circle cx="514" cy="188" r="2" /><circle cx="717" cy="357" r="2.5" /><circle cx="948" cy="250" r="2" /><circle cx="1088" cy="421" r="2.5" /><circle cx="173" cy="480" r="2" /><circle cx="764" cy="490" r="1.5" /></g>
      </svg>

      <div className="demo-map-label"><span className="demo-map-dot" /><span>깊은 숲 · 달빛이 머무는 곳</span><small>CH. 01</small></div>
      <div className="demo-game-buffs" aria-hidden="true">
        <span className="game-buff buff-purple">✦<small>02:48</small></span>
        <span className="game-buff buff-gold">♜<small>04:32</small></span>
        <span className="game-buff buff-blue">↑<small>29:10</small></span>
        <span className="game-buff buff-pink">ϟ<small>09:45</small></span>
      </div>
      <div className="demo-game-hud" aria-hidden="true">
        <div className="demo-level"><small>LEVEL</small><strong>260</strong></div>
        <div className="demo-hud-bars"><div className="demo-hp"><span>HP</span><i /><small>38,420 / 38,420</small></div><div className="demo-mp"><span>MP</span><i /><small>24,800 / 24,800</small></div></div>
        <div className="demo-exp"><div><span>EXP</span><small>54.28%</small></div><i><b /></i></div>
        <div className="demo-hotkeys">Q <span>W</span> E <span>R</span></div>
      </div>
      <div className="demo-watermark"><span>DEMO</span> 테스트용 시뮬레이션</div>
    </div>
  )
}
