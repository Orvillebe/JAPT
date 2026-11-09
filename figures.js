/**
 * JAPT Figures - the small figures that sometimes walk by when a task is checked off.
 *
 * Responsibilities:
 *   - The drawings: robot, chicken (and its egg), lamb, vacuum cleaner, cat
 *   - Deciding whether one comes by: by chance (config), one at a time, never with reduced motion
 *   - Playing it in its own layer above the page, removed again when it is done
 *
 * Decoration only: nothing here reads or changes data. The layer is position fixed and outside the
 * screens, so a redraw of the page doesn't wipe a figure that is on its way.
 */

const Figures = (() => {
  // The timings in the play functions are each figure's choreography, tuned by eye; they stay next to
  // the step they time. Only what several figures share has a name.

  const SVG = {
    robot: `<svg viewBox="0 0 40 40"><line x1="20" y1="3" x2="20" y2="9" stroke="#8a93a0" stroke-width="1.6"/><circle class="light" cx="20" cy="3" r="2.4" fill="#cf6a52"/><rect x="2.5" y="17" width="3.5" height="9" rx="1.7" fill="#8a93a0"/><rect x="6" y="9" width="28" height="25" rx="8" fill="#dfe4ea" stroke="#8a93a0" stroke-width="1.4"/><rect x="10" y="14" width="20" height="13" rx="5" fill="#2f3744"/><circle class="eye" cx="16" cy="20" r="2.3" fill="#9fe3b0"/><circle class="eye" cx="24" cy="20" r="2.3" fill="#9fe3b0"/><path d="M17 24 q3 2.2 6 0" stroke="#9fe3b0" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="11.5" cy="24" r="1.6" fill="#f4b9a8" opacity=".8"/><circle cx="28.5" cy="24" r="1.6" fill="#f4b9a8" opacity=".8"/><g class="arm"><rect x="34" y="18" width="3.4" height="9" rx="1.7" fill="#8a93a0"/><circle cx="35.7" cy="17" r="3.4" fill="#dfe4ea" stroke="#8a93a0" stroke-width="1.2"/></g></svg>`,
    chicken: `<svg viewBox="0 0 46 42"><path d="M10 24q-7-7-2-14 3 6 7 10z" fill="#fff" stroke="#d9d2c3" stroke-width="1.2"/><ellipse cx="23" cy="28" rx="15" ry="11" fill="#fff" stroke="#d9d2c3" stroke-width="1.2"/><ellipse cx="22" cy="28" rx="7" ry="5" fill="#f3efe6" stroke="#d9d2c3"/><circle cx="33" cy="15" r="8" fill="#fff" stroke="#d9d2c3" stroke-width="1.2"/><circle cx="30" cy="7" r="2.5" fill="#cf6a52"/><circle cx="33.5" cy="5.5" r="2.7" fill="#cf6a52"/><circle cx="37" cy="7" r="2.4" fill="#cf6a52"/><polygon points="40,14 46,16 40,18" fill="#e5a53a"/><circle cx="35.5" cy="13" r="1.5" fill="#232323"/><circle cx="35" cy="12.5" r=".5" fill="#fff"/><circle cx="31.5" cy="18" r="2" fill="#f4b9a8" opacity=".8"/><ellipse cx="38.5" cy="20.5" rx="1.8" ry="2.6" fill="#cf6a52"/><path d="M19 38v4M27 38v4" stroke="#e5a53a" stroke-width="2" stroke-linecap="round"/></svg>`,
    egg: `<svg viewBox="0 0 14 18"><ellipse cx="7" cy="10" rx="5.6" ry="7.2" fill="#f6ead3" stroke="#d9c9a6" stroke-width="1.2"/><ellipse cx="5" cy="7.5" rx="1.4" ry="2" fill="#fff" opacity=".7"/></svg>`,
    lamb: `<svg viewBox="0 0 46 34"><g fill="#fff" stroke="#d3cec2" stroke-width="1.6"><circle cx="12" cy="16" r="8"/><circle cx="20" cy="11" r="8"/><circle cx="29" cy="12" r="8"/><circle cx="35" cy="19" r="7.5"/><circle cx="24" cy="21" r="9"/><circle cx="14" cy="23" r="7"/></g><g fill="#fff"><circle cx="12" cy="16" r="8"/><circle cx="20" cy="11" r="8"/><circle cx="29" cy="12" r="8"/><circle cx="35" cy="19" r="7.5"/><circle cx="24" cy="21" r="9"/><circle cx="14" cy="23" r="7"/></g><g fill="#4a4640"><rect x="15" y="27" width="2.8" height="7" rx="1.4"/><rect x="22" y="28" width="2.8" height="6" rx="1.4"/><rect x="29" y="27" width="2.8" height="7" rx="1.4"/><rect x="35" y="27" width="2.8" height="6.5" rx="1.4"/><ellipse cx="40" cy="19" rx="5.5" ry="5"/><ellipse cx="35.5" cy="16" rx="3" ry="1.6" transform="rotate(-25 35.5 16)"/></g><circle cx="41.5" cy="17.8" r="1.1" fill="#fff"/><circle cx="38" cy="21.5" r="1.4" fill="#f4b9a8" opacity=".8"/></svg>`,
    vac: `<svg viewBox="0 0 38 22"><ellipse cx="19" cy="20.5" rx="7" ry="1.6" fill="#6b675d"/><ellipse cx="19" cy="14" rx="18" ry="6.5" fill="#dfe4ea" stroke="#8a93a0" stroke-width="1.3"/><path d="M8 13a11 10 0 0 1 22 0z" fill="#eef1f4" stroke="#8a93a0" stroke-width="1.3"/><circle cx="19" cy="3.6" r="1.8" fill="#cf6a52"/><circle cx="14.5" cy="9" r="1.9" fill="#2f3744"/><circle cx="23.5" cy="9" r="1.9" fill="#2f3744"/><path d="M17 11.2q2 1.6 4 0" stroke="#2f3744" stroke-width="1.2" fill="none" stroke-linecap="round"/><circle cx="9.5" cy="12" r="1.5" fill="#f4b9a8" opacity=".8"/><circle cx="28.5" cy="12" r="1.5" fill="#f4b9a8" opacity=".8"/></svg>`,
    cat: `<svg viewBox="0 0 34 30"><polygon points="5,13 6,2 15,8" fill="#e9b27c" stroke="#c98f58" stroke-width="1.2" stroke-linejoin="round"/><polygon points="29,13 28,2 19,8" fill="#e9b27c" stroke="#c98f58" stroke-width="1.2" stroke-linejoin="round"/><polygon points="7,10 7.5,5 11,8" fill="#f2b7a8"/><polygon points="27,10 26.5,5 23,8" fill="#f2b7a8"/><ellipse cx="17" cy="19" rx="13.5" ry="10.5" fill="#e9b27c" stroke="#c98f58" stroke-width="1.2"/><path d="M14 10v3M17 9.5v3.5M20 10v3" stroke="#c98f58" stroke-width="1.2" stroke-linecap="round"/><path d="M10.5 19q2-2.8 4 0M19.5 19q2-2.8 4 0" stroke="#232323" stroke-width="1.6" fill="none" stroke-linecap="round"/><polygon points="15.6,21.5 18.4,21.5 17,23" fill="#e58f86"/><path d="M17 23q-1.8 2-3.8.2M17 23q1.8 2 3.8.2" stroke="#232323" stroke-width="1" fill="none" stroke-linecap="round"/><path d="M5 20l-5-1M5 22.5l-5 2M29 20l5-1M29 22.5l5 2" stroke="#c98f58" stroke-width=".9" stroke-linecap="round"/></svg>`
  };

  // A row narrower than this (a small block in the calendar) has no room for a figure.
  const MIN_ROW_WIDTH = 60;
  // The strip right above the row where figures appear; the row itself stays visible below it.
  const STAGE_HEIGHT = 46;
  // Lower than the strip is high, so a figure parked here is clipped away: it can rise from behind the row.
  const BELOW_STAGE = 'translateY(52px)';
  // Overshoots a little at the top, so rising looks like popping up.
  const RISE_EASING = 'cubic-bezier(.2,1.3,.5,1)';
  const SINK_MS = 350;
  // Above the page's own layers (pop-ups and the calendar card).
  const STAGE_Z_INDEX = 9000;
  // Matches width:34px below, to centre the cat over the checkbox.
  const CAT_WIDTH = 34;
  // Walkers start just left of the row and end this far past its right edge, so they leave completely.
  const WALK_OFF_PX = 10;

  let busy = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const anim = (el, keyframes, options) => el.animate(keyframes, { fill: 'forwards', easing: 'ease', ...options });

  const rise = (el, duration) =>
    anim(el, [{ transform: BELOW_STAGE }, { transform: 'none' }], { duration, easing: RISE_EASING }).finished;
  const sink = el =>
    anim(el, [{ transform: 'none' }, { transform: BELOW_STAGE }], { duration: SINK_MS, easing: 'ease-in' }).finished;
  const wobble = (el, lean, duration) => anim(el, [
    { transform: 'rotate(0)' },
    { transform: `rotate(-${lean}deg)` },
    { transform: `rotate(${lean}deg)` },
    { transform: 'rotate(-5deg)' },
    { transform: 'rotate(0)' }
  ], { duration });

  function makeStage(row) {
    const stage = document.createElement('div');
    stage.style.cssText = `position:fixed;left:${row.left}px;top:${row.top - STAGE_HEIGHT}px;width:${row.width}px;`
      + `height:${STAGE_HEIGHT}px;overflow:hidden;pointer-events:none;z-index:${STAGE_Z_INDEX}`;
    document.body.appendChild(stage);
    return stage;
  }

  function addFigure(stage, svg, css) {
    const figure = document.createElement('div');
    figure.style.cssText = 'position:absolute;' + css;
    figure.innerHTML = svg;
    figure.firstElementChild.style.cssText = 'display:block;width:100%;height:100%;overflow:visible';
    stage.appendChild(figure);
    return figure;
  }

  function waveArm(arm) {
    arm.style.cssText = 'transform-box:fill-box;transform-origin:50% 100%';
    anim(arm, [{ transform: 'rotate(0)' }, { transform: 'rotate(-35deg)' }], {
      duration: 350, iterations: 4, direction: 'alternate'
    });
  }

  function blinkLight(light) {
    anim(light, [{ opacity: 1 }, { opacity: 0.15 }], { duration: 300, iterations: 4, direction: 'alternate' });
  }

  function blinkEye(eye) {
    eye.style.cssText = 'transform-box:fill-box;transform-origin:center';
    anim(eye, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.1)' }, { transform: 'scaleY(1)' }], {
      duration: 240, delay: 600
    });
  }

  async function playRobot(stage) {
    const robot = addFigure(stage, SVG.robot, `left:64%;top:6px;width:40px;height:40px;transform:${BELOW_STAGE}`);
    await rise(robot, 450);
    waveArm(robot.querySelector('.arm'));
    blinkLight(robot.querySelector('.light'));
    robot.querySelectorAll('.eye').forEach(blinkEye);
    await sleep(1500);
    await sink(robot);
  }

  function layEgg(egg) {
    anim(egg, [
      { opacity: 0, transform: 'translateY(-8px) scale(.4)' },
      { opacity: 1, transform: 'translateY(0) scale(1.15)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' }
    ], { duration: 450 });
  }

  async function playChicken(stage) {
    const hen = addFigure(stage, SVG.chicken, `left:52%;top:4px;width:46px;height:42px;transform:${BELOW_STAGE}`);
    const egg = addFigure(stage, SVG.egg, 'left:calc(52% - 17px);top:28px;width:14px;height:18px;opacity:0');
    await rise(hen, 420);
    wobble(hen, 6, 700);
    await sleep(650);
    layEgg(egg);
    await sleep(1100);
    anim(egg, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 200 });
    await sink(hen);
    await sleep(300);
  }

  async function playLamb(stage, row) {
    const WALK_MS = 2200, HOP_FRAMES = 10;
    const lamb = addFigure(stage, SVG.lamb, 'left:0;top:12px;width:46px;height:34px;opacity:0');
    anim(lamb, [
      { opacity: 1, transform: 'translate(-56px,0)' },
      { opacity: 1, transform: `translate(${row.width + WALK_OFF_PX}px,0)` }
    ], { duration: WALK_MS, easing: 'linear' });
    // Every other frame is up in the air; the hops ride on the drawing, the walk on its wrapper.
    const hops = Array.from({ length: HOP_FRAMES + 1 }, (_, i) => ({
      transform: i % 2 ? 'translateY(-14px)' : 'translateY(0)',
      offset: i / HOP_FRAMES
    }));
    anim(lamb.firstElementChild, hops, { duration: WALK_MS, easing: 'ease-out' });
    await sleep(WALK_MS + 50);
  }

  async function playVacuum(stage, row) {
    const vacuum = addFigure(stage, SVG.vac, 'left:0;top:24px;width:38px;height:22px;opacity:0');
    await anim(vacuum, [
      { opacity: 1, transform: 'translateX(-44px)' },
      { opacity: 1, transform: `translateX(${row.width + WALK_OFF_PX}px)` }
    ], { duration: 2100, easing: 'linear' }).finished;
  }

  // The cat looks up right above the checkbox, kept inside the row.
  async function playCat(stage, row, check) {
    const overCheck = check.left - row.left + check.width / 2 - CAT_WIDTH / 2;
    const left = Math.max(0, Math.min(row.width - CAT_WIDTH, overCheck));
    const place = `left:${left}px;top:16px;width:${CAT_WIDTH}px;height:30px;transform:${BELOW_STAGE}`;
    const head = addFigure(stage, SVG.cat, place);
    await rise(head, 420);
    await wobble(head, 7, 900).finished;
    await sleep(250);
    await sink(head);
  }

  const PLAYERS = { robot: playRobot, chicken: playChicken, lamb: playLamb, vac: playVacuum, cat: playCat };
  const KINDS = Object.keys(PLAYERS);

  async function play(kind, row, check) {
    busy = true;
    const stage = makeStage(row);
    try {
      await PLAYERS[kind](stage, row, check);
    } finally {
      stage.remove();
      busy = false;
    }
  }

  const reducedMotion = () => matchMedia('(prefers-reduced-motion:reduce)').matches;

  // box: the checkbox that was just checked. A figure is a treat, so a failing animation is ignored.
  function maybe(box) {
    if (busy || reducedMotion() || Math.random() >= JAPT_CONFIG.figureChance) return;
    const rowEl = box.closest('.task,.chip,.pt') || box.parentElement;
    if (!rowEl) return;
    const row = rowEl.getBoundingClientRect(), check = box.getBoundingClientRect();
    if (row.width < MIN_ROW_WIDTH) return;
    play(KINDS[Math.floor(Math.random() * KINDS.length)], row, check).catch(() => {});
  }

  return { maybe };
})();
