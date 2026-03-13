const IS_PROJECTION = new URLSearchParams(window.location.search).get("projection") === "1";
const SYNC_KEY = "family_feud_sync_state";
const SYNC_ANIMATION_KEY = "family_feud_sync_animation";
const SYNC_STAGE_WINNER_KEY = "family_feud_sync_stage_winner";
const syncChannel = ("BroadcastChannel" in window) ? new BroadcastChannel("family-feud-sync") : null;

let stage = 1; // 1=Igra1, 2=Igra2, 3=Finale
let roundIndex = 0;

let teams = [
  { name: "TIM A1", score: 0 },
  { name: "TIM A2", score: 0 },
  { name: "TIM B1", score: 0 },
  { name: "TIM B2", score: 0 }
];

let finalTeams = [];
let activeTeams = [0, 1];
let currentTeam = 0;

let strikes = 0;
let strikeLabel = "";
let revealed = [];
let roundPoints = 0;
let stealMode = false;
let gameStarted = false;
let estimationMode = false;
let estimationRevealed = false;
let transitionInProgress = false;
let pendingStageContinue = null;
let pendingStageImage = null;
let pendingWinnerImage = null;
let transitionTimer = null;
let transitionFlipTimer = null;
const QUESTION_TRANSITION_FRONT_DELAY = 900;
const QUESTION_TRANSITION_DURATION = 2600;

// AUDIO
const SOUND_ENABLED = true;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const SOUND_SETTINGS_KEY = "family_feud_sound_settings_v1";
let activeSuddenDeathAudio = null;
const DEFAULT_SOUND_VOLUMES = {
  correct: 95,
  wrong: 95,
  suddenDeath: 95,
  win: 95
};

function normalizeSoundVolume(value, fallback = 95) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function loadSoundVolumes() {
  try {
    const raw = localStorage.getItem(SOUND_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SOUND_VOLUMES };
    const parsed = JSON.parse(raw);
    return {
      correct: normalizeSoundVolume(parsed && parsed.correct, DEFAULT_SOUND_VOLUMES.correct),
      wrong: normalizeSoundVolume(parsed && parsed.wrong, DEFAULT_SOUND_VOLUMES.wrong),
      suddenDeath: normalizeSoundVolume(parsed && parsed.suddenDeath, DEFAULT_SOUND_VOLUMES.suddenDeath),
      win: normalizeSoundVolume(parsed && parsed.win, DEFAULT_SOUND_VOLUMES.win)
    };
  } catch (_) {
    return { ...DEFAULT_SOUND_VOLUMES };
  }
}

let SOUND_VOLUMES = loadSoundVolumes();

function getSoundVolume(name) {
  return normalizeSoundVolume(SOUND_VOLUMES[name], DEFAULT_SOUND_VOLUMES[name] || 95) / 100;
}

function syncSoundSettingsUI() {
  const config = {
    correct: ["soundCorrectRange", "soundCorrectValue"],
    wrong: ["soundWrongRange", "soundWrongValue"],
    suddenDeath: ["soundSuddenDeathRange", "soundSuddenDeathValue"],
    win: ["soundWinRange", "soundWinValue"]
  };

  Object.entries(config).forEach(([key, ids]) => {
    const [rangeId, valueId] = ids;
    const range = document.getElementById(rangeId);
    const value = document.getElementById(valueId);
    const volume = normalizeSoundVolume(SOUND_VOLUMES[key], DEFAULT_SOUND_VOLUMES[key] || 95);
    if (range) range.value = String(volume);
    if (value) value.innerText = `${volume}%`;
  });
}

function setSoundVolume(name, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SOUND_VOLUMES, name)) return;
  SOUND_VOLUMES[name] = normalizeSoundVolume(value, DEFAULT_SOUND_VOLUMES[name]);
  try {
    localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(SOUND_VOLUMES));
  } catch (_) {
    // ignore storage errors
  }
  syncSoundSettingsUI();
}

function tone(freq, dur, volumeMultiplier = 1) {
  if (!SOUND_ENABLED) return;
  const volume = Math.max(0, Number(volumeMultiplier) || 0);
  if (volume <= 0) return;
  const o = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  o.type = "square";
  o.frequency.value = freq;
  gain.gain.value = 0.18 * volume;
  o.connect(gain);
  gain.connect(audioCtx.destination);
  o.start();
  setTimeout(() => o.stop(), dur);
}

function bellTone(freq, dur, gainLevel, type = "sine", volumeMultiplier = 1) {
  if (!SOUND_ENABLED) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const volume = Math.max(0, Number(volumeMultiplier) || 0);
  if (volume <= 0) return;
  gain.gain.setValueAtTime(gainLevel * volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur / 1000);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + dur / 1000);
}

const CORRECT_SOURCES = [
  "sounds/family-feud-correct.mp3",
  "https://actions.google.com/sounds/v1/cartoon/concussive_drum_hit.ogg"
];

function playCorrectFallback() {
  if (!SOUND_ENABLED) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  const volume = getSoundVolume("correct");
  bellTone(880, 420, 0.22, "sine", volume);
  bellTone(1320, 360, 0.14, "triangle", volume);
  bellTone(1760, 300, 0.09, "sine", volume);
}

function playCorrectFromSource(index = 0) {
  if (!SOUND_ENABLED) return;
  if (index >= CORRECT_SOURCES.length) {
    playCorrectFallback();
    return;
  }

  const ding = new Audio(CORRECT_SOURCES[index]);
  ding.volume = getSoundVolume("correct");
  ding.play().catch(() => playCorrectFromSource(index + 1));
}

function correctSound() {
  playCorrectFromSource(0);
}

const WRONG_SOURCES = [
  "sounds/family feud wrong.mp3"
];

const SUDDEN_DEATH_SOURCES = [
  "sounds/Family Feud - Sudden Death.mp3"
];

function playWrongFallback() {
  tone(150, 400, getSoundVolume("wrong"));
}

function playWrongFromSource(index = 0) {
  if (!SOUND_ENABLED) return;
  if (index >= WRONG_SOURCES.length) {
    playWrongFallback();
    return;
  }

  const wrong = new Audio(WRONG_SOURCES[index]);
  wrong.volume = getSoundVolume("wrong");
  wrong.play().catch(() => playWrongFromSource(index + 1));
}

function strikeSound() {
  playWrongFromSource(0);
}

function stopSuddenDeathSound() {
  if (!activeSuddenDeathAudio) return;
  try {
    activeSuddenDeathAudio.pause();
    activeSuddenDeathAudio.currentTime = 0;
  } catch (_) {
    // ignore audio stop errors
  }
  activeSuddenDeathAudio = null;
}

function playSuddenDeathFromSource(index = 0) {
  if (!SOUND_ENABLED) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (index >= SUDDEN_DEATH_SOURCES.length) return;

  stopSuddenDeathSound();
  const suddenDeath = new Audio(SUDDEN_DEATH_SOURCES[index]);
  activeSuddenDeathAudio = suddenDeath;
  suddenDeath.volume = getSoundVolume("suddenDeath");
  suddenDeath.addEventListener("ended", () => {
    if (activeSuddenDeathAudio === suddenDeath) activeSuddenDeathAudio = null;
  }, { once: true });
  suddenDeath.play().catch(() => {
    if (activeSuddenDeathAudio === suddenDeath) activeSuddenDeathAudio = null;
    playSuddenDeathFromSource(index + 1);
  });
}

function suddenDeathSound() {
  playSuddenDeathFromSource(0);
}

function stealSound() {
  return;
}

function winSound() {
  tone(1200, 600, getSoundVolume("win"));
}

function setStrikesDisplay(value) {
  strikeLabel = value;
  const el = document.getElementById("strikes");
  if (el) el.innerText = value;
}
const DEFAULT_STAGE_ESTIMATION = {
  1: { question: "PITANJE PROCJENE - GAME ONE", answer: "TIM SA NAJBLIZIM ODGOVOROM IMA PREDNOST" },
  2: { question: "PITANJE PROCJENE - GAME TWO", answer: "TIM SA NAJBLIZIM ODGOVOROM IMA PREDNOST" },
  3: { question: "PITANJE PROCJENE - FINALE", answer: "TIM SA NAJBLIZIM ODGOVOROM IMA PREDNOST" }
};

let STAGE_ESTIMATION = JSON.parse(JSON.stringify(DEFAULT_STAGE_ESTIMATION));

function getEstimationPrompt(targetStage = stage) {
  return STAGE_ESTIMATION[targetStage] || STAGE_ESTIMATION[1];
}

function setEstimationPromptForStage(targetStage, prompt) {
  STAGE_ESTIMATION[targetStage] = {
    question: prompt.question,
    answer: prompt.answer
  };
}

function validateEstimationPrompt(prompt) {
  if (!prompt || typeof prompt.question !== "string" || typeof prompt.answer !== "string") return false;
  return prompt.question.trim().length > 0 && prompt.answer.trim().length > 0;
}

function updateControlVisibility() {
  const estimationControls = document.getElementById("estimationControls");
  if (estimationControls) {
    estimationControls.classList.toggle("hidden", !estimationMode);
  }

  const stageContinueControls = document.getElementById("stageContinueControls");
  if (stageContinueControls) {
    const showContinue = false;
    stageContinueControls.classList.toggle("hidden", !showContinue);
  }

  const controlProjectionBtn = document.getElementById("controlProjectionBtn");
  if (controlProjectionBtn) {
    controlProjectionBtn.classList.add("hidden");
  }

  const controlSettingsBtn = document.getElementById("controlSettingsBtn");
  if (controlSettingsBtn) {
    controlSettingsBtn.classList.add("hidden");
  }
}
function updateRevealButtons(round) {
  for (let i = 0; i < 8; i++) {
    const btn = document.getElementById(`revealBtn${i}`);
    if (!btn) continue;

    const answer = round && Array.isArray(round.answers) ? round.answers[i] : null;
    if (!answer) {
      btn.classList.add("hidden");
      btn.disabled = true;
      continue;
    }

    btn.classList.remove("hidden");
    btn.innerText = answer.text;
    btn.disabled = revealed.includes(i);
  }
}

function renderEstimationRound() {
  const prompt = getEstimationPrompt();
  const estimationRound = {
    question: prompt.question,
    multiplier: 1,
    answers: [{ text: prompt.answer, points: "" }]
  };

  renderBoard(estimationRound, estimationRevealed ? [0] : []);
  const q = document.getElementById("question");
  if (q) q.innerText = prompt.question;
  roundPoints = 0;
  setStrikesDisplay("");
  updateRoundTotal();
  updateTopBar();
  updateRevealButtons(estimationRound);
  updateControlVisibility();
}

function startStageEstimation() {
  suddenDeathSound();
  estimationMode = true;
  estimationRevealed = false;
  strikes = 0;
  strikeLabel = "";
  revealed = [];
  roundPoints = 0;
  renderEstimationRound();
  publishState();
}

function chooseAdvantageTeam(teamIndex) {
  if (IS_PROJECTION || !estimationMode || transitionInProgress || pendingStageContinue) return;
  stopSuddenDeathSound();
  currentTeam = teamIndex === 1 ? 1 : 0;
  estimationMode = false;
  estimationRevealed = false;
  updateTopBar();
  updateControlVisibility();

  const roundNo = roundIndex + 1;
  triggerProjectionAnimation(roundNo);

  if (typeof window.runQuizAnimation === "function") {
    window.runQuizAnimation(roundNo, function () {
      loadRound(false);
    });
    return;
  }

  loadRound();
}
function renderBoard(round, revealedIndexes = []) {
  const board = document.getElementById("board");
  if (!board || !round) return;

  const isEstimationBoard = estimationMode === true;
  const totalSlots = isEstimationBoard ? 1 : 8;

  board.classList.toggle("estimation-mode", isEstimationBoard);
  board.innerHTML = "";

  for (let i = 0; i < totalSlots; i++) {
    const hasAnswer = i < round.answers.length;
    const isShown = revealedIndexes.includes(i);
    const div = document.createElement("div");
    div.classList.add("answer");
    if (!hasAnswer) div.classList.add("empty");
    if (isShown) div.classList.add("revealed");
    div.id = "ans" + i;

    const slotLabel = isEstimationBoard ? "?" : (hasAnswer ? (i + 1) : "");
    const answerText = (isShown && hasAnswer) ? round.answers[i].text : "";
    const answerPoints = (isShown && hasAnswer) ? round.answers[i].points : "";

    div.innerHTML = `
      <div class="answer-inner">
        <div class="face face-front">
          <span class="slot-num">${slotLabel}</span>
        </div>
        <div class="face face-reveal">
          <span class="answer-text">${answerText}</span>
          <span class="answer-points">${answerPoints}</span>
        </div>
        <div class="face face-back"></div>
        <div class="face face-top"></div>
      </div>
    `;

    board.appendChild(div);
  }
}

function updateTopBar() {
  const team1 = document.getElementById("team1");
  const team2 = document.getElementById("team2");
  if (!team1 || !team2) return;

  team1.innerHTML = teams[activeTeams[0]].name + " <span>" + teams[activeTeams[0]].score + "</span>";
  team2.innerHTML = teams[activeTeams[1]].name + " <span>" + teams[activeTeams[1]].score + "</span>";
  document.querySelectorAll(".team").forEach((t) => t.classList.remove("active"));
  const active = document.getElementById("team" + (currentTeam + 1));
  if (active) active.classList.add("active");
}

function updateRoundTotal() {
  const total = document.getElementById("roundTotal");
  if (total) total.innerText = roundPoints;
}

function getStateSnapshot() {
  return {
    stage,
    roundIndex,
    teams,
    finalTeams,
    activeTeams,
    currentTeam,
    strikes,
    strikeLabel,
    revealed,
    roundPoints,
    stealMode,
    gameStarted,
    estimationMode,
    estimationRevealed
  };
}

function publishState() {
  if (IS_PROJECTION || transitionInProgress || pendingStageContinue) return;
  const state = getStateSnapshot();
  localStorage.setItem(SYNC_KEY, JSON.stringify(state));
  if (syncChannel) syncChannel.postMessage({ type: "state", payload: state });
}

function triggerProjectionAnimation(roundNo) {
  if (IS_PROJECTION) return;
  const payload = { roundNo, ts: Date.now() };
  if (syncChannel) syncChannel.postMessage({ type: "animation", payload });
  localStorage.setItem(SYNC_ANIMATION_KEY, JSON.stringify(payload));
}

function getWinnerImageForTeam(teamIndex) {
  const name = (teams[teamIndex] && teams[teamIndex].name ? teams[teamIndex].name : "").toUpperCase();
  if (name.includes("A1")) return "pictures/a1.png";
  if (name.includes("A2")) return "pictures/a2.png";
  if (name.includes("B1")) return "pictures/b1.png";
  if (name.includes("B2")) return "pictures/b2.png";

  const fallback = {
    0: "pictures/a1.png",
    1: "pictures/a2.png",
    2: "pictures/b1.png",
    3: "pictures/b2.png"
  };
  return fallback[teamIndex] || "pictures/druga.png";
}
function triggerProjectionStageWinner(message, imageSrc = "pictures/druga.png", showMessage = true, transitionMode = "") {
  if (IS_PROJECTION) return;
  const payload = { message, imageSrc, showMessage, transitionMode, ts: Date.now() };
  if (syncChannel) syncChannel.postMessage({ type: "stage_winner", payload });
  localStorage.setItem(SYNC_STAGE_WINNER_KEY, JSON.stringify(payload));
}

function applyProjectionState(state) {
  if (!state) return;
  if (typeof window.isWinnerHoldOverlayActive === "function" && window.isWinnerHoldOverlayActive()) {
    if (typeof window.dismissStageWinnerOverlay === "function") {
      window.dismissStageWinnerOverlay();
    }
  }

  stage = state.stage;
  roundIndex = state.roundIndex;
  teams = state.teams;
  finalTeams = state.finalTeams;
  activeTeams = state.activeTeams;
  currentTeam = state.currentTeam;
  strikes = state.strikes;
  strikeLabel = state.strikeLabel || "";
  revealed = state.revealed || [];
  roundPoints = state.roundPoints;
  stealMode = state.stealMode;
  gameStarted = !!state.gameStarted;
  estimationMode = !!state.estimationMode;
  estimationRevealed = !!state.estimationRevealed;

  const start = document.getElementById("startScreen");
  const root = document.getElementById("gameRoot");

  if (!gameStarted) {
    if (start) start.classList.remove("hidden");
    if (root) root.classList.add("hidden");
    return;
  }

  if (start) start.classList.add("hidden");
  if (root) root.classList.remove("hidden");

  if (estimationMode) {
    renderEstimationRound();
    return;
  }

  const round = getQuestionsForStage()[roundIndex];
  if (!round) return;

  renderBoard(round, revealed);
  const q = document.getElementById("question");
  if (q) q.innerText = round.question;
  setStrikesDisplay(strikeLabel);
  updateRoundTotal();
  updateTopBar();
}

function setupSync() {
  const handleStageWinnerPayload = (payload) => {
    const message = payload && payload.message ? payload.message : "POBJEDNIK JE TIM";
    const imageSrc = payload && payload.imageSrc ? payload.imageSrc : "pictures/druga.png";
    const showMessage = payload && Object.prototype.hasOwnProperty.call(payload, "showMessage") ? payload.showMessage : true;
    const isWinnerImage = /(?:^|\/)(a1|a2|b1|b2)\.png$/i.test(imageSrc);
    const transitionMode = payload && payload.transitionMode ? payload.transitionMode : "";
    const holdActive = (typeof window.isWinnerHoldOverlayActive === "function") && window.isWinnerHoldOverlayActive();

    if (!showMessage && isWinnerImage && typeof window.runSpecialImageTransition === "function") {
      if (transitionMode === "resume") {
        window.runSpecialImageTransition(imageSrc, function () {}, { continueFromHold: true });
      } else if (transitionMode === "hold") {
        window.runSpecialImageTransition(imageSrc, null, { holdAtCenter: true });
      } else {
        window.runSpecialImageTransition(
          imageSrc,
          holdActive ? function () {} : null,
          holdActive ? { continueFromHold: true } : { holdAtCenter: true }
        );
      }
      return;
    }

    if (typeof window.runStageWinnerTransition === "function") {
      window.runStageWinnerTransition(message, showMessage ? null : function () {}, imageSrc, showMessage);
    }
  };

  if (syncChannel) {
    syncChannel.onmessage = (event) => {
      const msg = event.data || {};
      if (IS_PROJECTION) {
        if (msg.type === "state") applyProjectionState(msg.payload);
        if (msg.type === "animation" && typeof window.runQuizAnimation === "function") {
          const roundNo = msg.payload && msg.payload.roundNo ? msg.payload.roundNo : 1;
          window.runQuizAnimation(roundNo);
        }
        if (msg.type === "stage_winner") {
          handleStageWinnerPayload(msg.payload || {});
        }
      } else if (msg.type === "request_state") {
        publishState();
      }
    };
  }

  window.addEventListener("storage", (event) => {
    if (!IS_PROJECTION) return;
    if (!event.newValue) return;

    if (event.key === SYNC_KEY) {
      try {
        applyProjectionState(JSON.parse(event.newValue));
      } catch (_) {
        // ignore invalid payload
      }
      return;
    }

    if (event.key === SYNC_ANIMATION_KEY && typeof window.runQuizAnimation === "function") {
      try {
        const parsed = JSON.parse(event.newValue);
        const roundNo = parsed && parsed.roundNo ? parsed.roundNo : 1;
        window.runQuizAnimation(roundNo);
      } catch (_) {
        // ignore invalid payload
      }
      return;
    }

    if (event.key === SYNC_STAGE_WINNER_KEY) {
      try {
        const parsed = JSON.parse(event.newValue);
        handleStageWinnerPayload(parsed || {});
      } catch (_) {
        // ignore invalid payload
      }
    }
  });

  if (IS_PROJECTION) {
    if (syncChannel) syncChannel.postMessage({ type: "request_state" });
    try {
      if (typeof window.runQuizAnimation === "function") {
        const rawAnim = localStorage.getItem(SYNC_ANIMATION_KEY);
        if (rawAnim) {
          const parsedAnim = JSON.parse(rawAnim);
          const age = Date.now() - Number(parsedAnim.ts || 0);
          if (age >= 0 && age < 10000) {
            const roundNo = parsedAnim && parsedAnim.roundNo ? parsedAnim.roundNo : 1;
            window.runQuizAnimation(roundNo);
          }
        }
      }

      const rawWinner = localStorage.getItem(SYNC_STAGE_WINNER_KEY);
      if (rawWinner) {
        const parsedWinner = JSON.parse(rawWinner);
        const age = Date.now() - Number(parsedWinner.ts || 0);
        if (age >= 0 && age < 10000) {
          handleStageWinnerPayload(parsedWinner || {});
        }
      }
    } catch (_) {
      // ignore replay errors
    }
  }
}
function showQuestionTransition(questionNo, onDone) {
  if (typeof onDone === "function") onDone();
}

function renderRoundBoard(round) {
  setStrikesDisplay("");
  renderBoard(round, revealed);

  const q = document.getElementById("question");
  if (q) q.innerText = round.question;
  updateRoundTotal();
  updateTopBar();
  updateRevealButtons(round);
  publishState();
}
// INIT ROUND
function loadRound(showTransition = true) {
  estimationMode = false;
  estimationRevealed = false;
  updateControlVisibility();
  const round = getQuestionsForStage()[roundIndex];
  revealed = [];
  strikes = 0;
  roundPoints = 0;
  stealMode = false;

  if (!round) return;

  const renderNow = () => renderRoundBoard(round);

  if (showTransition && gameStarted && !IS_PROJECTION) {
    showQuestionTransition(roundIndex + 1, renderNow);
    return;
  }

  renderNow();
}

// CONTROL FUNCTIONS
function revealAnswer(i) {
  if (IS_PROJECTION || transitionInProgress || pendingStageContinue) return;

  if (estimationMode) {
    if (i !== 0 || estimationRevealed) return;

    const prompt = getEstimationPrompt();
    const slot = document.getElementById("ans0");
    if (!slot) return;

    estimationRevealed = true;
    slot.classList.add("revealed");

    const answerTextEl = slot.querySelector(".answer-text");
    if (answerTextEl) answerTextEl.innerText = prompt.answer;

    const answerPointsEl = slot.querySelector(".answer-points");
    if (answerPointsEl) answerPointsEl.innerText = "";

    // Procjena ne nosi bodove.
    roundPoints = 0;
    updateRoundTotal();
    publishState();
    return;
  }

  const round = getQuestionsForStage()[roundIndex];
  if (!round || i >= round.answers.length || revealed.includes(i)) return;
  revealed.push(i);

  const slot = document.getElementById("ans" + i);
  if (slot) {
    slot.classList.add("revealed");
    slot.querySelector(".answer-text").innerText = round.answers[i].text;
    slot.querySelector(".answer-points").innerText = round.answers[i].points;
  }

  roundPoints += round.answers[i].points * round.multiplier;
  updateRoundTotal();
  correctSound();
  publishState();
}

function addStrike() {
  if (IS_PROJECTION || estimationMode || transitionInProgress || pendingStageContinue) return;
  strikes++;
  setStrikesDisplay("X ".repeat(strikes));
  strikeSound();

  if (strikes >= 3 && !stealMode) {
    stealMode = true;
    currentTeam = currentTeam === 0 ? 1 : 0;
    strikes = 0;
    setStrikesDisplay("STEAL!");
    stealSound();
    updateTopBar();
  }
  publishState();
}

function steal() {
  if (IS_PROJECTION || estimationMode || transitionInProgress || pendingStageContinue) return;
  teams[activeTeams[currentTeam]].score += roundPoints;
  nextRound();
}

function endRound() {
  if (IS_PROJECTION || estimationMode || transitionInProgress || pendingStageContinue) return;
  if (!stealMode) teams[activeTeams[currentTeam]].score += roundPoints;
  nextRound();
}

function switchTeam() {
  if (IS_PROJECTION || estimationMode || transitionInProgress || pendingStageContinue) return;
  currentTeam = currentTeam === 0 ? 1 : 0;
  updateTopBar();
  publishState();
}

// NEXT ROUND
function nextRound() {
  roundIndex++;
  const maxRounds = getQuestionsForStage().length;
  if (roundIndex >= maxRounds) {
    endMatch();
    return;
  }

  const roundNo = roundIndex + 1;
  triggerProjectionAnimation(roundNo);

  if (typeof window.runQuizAnimation === "function") {
    window.runQuizAnimation(roundNo, function () {
      loadRound(false);
    });
    return;
  }

  loadRound();
}

// END MATCH
function endMatch() {
  const t1 = teams[activeTeams[0]];
  const t2 = teams[activeTeams[1]];
  const winner = t1.score > t2.score ? activeTeams[0] : activeTeams[1];

  if (stage === 1) {
    finalTeams.push(winner);
    activeTeams = [2, 3];
    stage = 2;
    roundIndex = 0;

    const winnerImage = getWinnerImageForTeam(winner);
    const continueNextStage = function () {
      currentTeam = 0;
      startStageEstimation();
    };

    pendingStageContinue = continueNextStage;
    pendingStageImage = null;
    pendingWinnerImage = winnerImage;
    updateControlVisibility();

    triggerProjectionStageWinner("", winnerImage, false, "hold");
    if (typeof window.runSpecialImageTransition === "function") {
      window.runSpecialImageTransition(winnerImage, null, { holdAtCenter: true });
    }
    return;
  } else if (stage === 2) {
    finalTeams.push(winner);
    activeTeams = [finalTeams[0], finalTeams[1]];
    teams[activeTeams[0]].score = 0;
    teams[activeTeams[1]].score = 0;
    stage = 3;
    roundIndex = 0;

    const winnerImage = getWinnerImageForTeam(winner);
    const continueNextStage = function () {
      currentTeam = 0;
      startStageEstimation();
    };

    pendingStageContinue = continueNextStage;
    pendingStageImage = null;
    pendingWinnerImage = winnerImage;
    updateControlVisibility();

    triggerProjectionStageWinner("", winnerImage, false, "hold");
    if (typeof window.runSpecialImageTransition === "function") {
      window.runSpecialImageTransition(winnerImage, null, { holdAtCenter: true });
    }
    return;
  } else {
    const winnerImage = getWinnerImageForTeam(winner);
    winSound();
    triggerProjectionStageWinner("", winnerImage, false, "hold");
    if (typeof window.runSpecialImageTransition === "function") {
      window.runSpecialImageTransition(winnerImage, null, { holdAtCenter: true });
    }
    publishState();
    return;
  }
}

// WINNER
function showWinnerScreen(winnerIndex) {
  winSound();
  document.body.innerHTML = `
  <div style="text-align:center;margin-top:200px;">
  <h1 style="font-size:60px;color:gold;">POBJEDNIK JE TIM ${teams[winnerIndex].name}</h1>
  <button onclick="location.reload()" style="padding:20px;font-size:25px;">Igraj ponovo</button>
  </div>`;
}

function openProjection() {
  if (IS_PROJECTION || transitionInProgress || pendingStageContinue) return;
  const url = new URL("index.html", window.location.href);
  url.searchParams.set("projection", "1");
  url.searchParams.set("v", String(Date.now()));
  const popup = window.open(url.toString(), "family-feud-projection");
  if (!popup) {
    window.location.href = url.toString();
  }
}

function continueToNextStage() {
  if (IS_PROJECTION || transitionInProgress || !pendingStageContinue) return;
  const proceed = pendingStageContinue;
  const winnerImage = pendingWinnerImage;
  const imageSrc = pendingStageImage;
  pendingStageContinue = null;
  pendingStageImage = null;
  pendingWinnerImage = null;
  updateControlVisibility();
  if (winnerImage) {
    triggerProjectionStageWinner("", winnerImage, false, "resume");
    if (typeof window.runSpecialImageTransition === "function") {
      window.runSpecialImageTransition(winnerImage, proceed, { continueFromHold: true });
      return;
    }
  }
  if (typeof window.dismissStageWinnerOverlay === "function") {
    window.dismissStageWinnerOverlay();
  }
  const proceedToStage = function () {
    proceed();
  };

  if (imageSrc) {
    triggerProjectionStageWinner("", imageSrc, false);
    if (typeof window.runSpecialImageTransition === "function") {
      window.runSpecialImageTransition(imageSrc, proceedToStage);
      return;
    }
  }
  proceedToStage();
}

const QUESTIONS_STORAGE_KEY = "family_feud_questions";
const ESTIMATION_STORAGE_KEY = "family_feud_estimation";
const PERSISTENCE_KEY = "family_feud_persistent_data_v1";
const GOOGLE_SHEET_EXAMPLE_URL = "https://docs.google.com/spreadsheets/d/1GLyA8ZLjbESjuKqB6EJ7TbCbbq4v59EHUHykUzvrIMs/edit?usp=sharing";
const STAGE_OPTIONS = [1, 2, 3];
let editorSelectedStage = 1;

function cloneQuestions(data) {
  return JSON.parse(JSON.stringify(data));
}

const DEFAULT_STAGE_QUESTIONS = {
  1: cloneQuestions(GAME_DATA.slice(0, 4)),
  2: cloneQuestions(GAME_DATA.slice(0, 4)),
  3: cloneQuestions(GAME_DATA.slice(0, 5))
};

let STAGE_QUESTIONS = cloneQuestions(DEFAULT_STAGE_QUESTIONS);

function getQuestionStorageKey(targetStage) {
  return `${QUESTIONS_STORAGE_KEY}_${targetStage}`;
}

function getEstimationStorageKey(targetStage) {
  return `${ESTIMATION_STORAGE_KEY}_${targetStage}`;
}

function getQuestionsForStage(targetStage = stage) {
  return STAGE_QUESTIONS[targetStage] || STAGE_QUESTIONS[1];
}

function setQuestionsForStage(targetStage, data) {
  STAGE_QUESTIONS[targetStage] = cloneQuestions(data);
}

function validateQuestionsData(data) {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.every((round) => {
    if (!round || typeof round.question !== "string") return false;
    if (!Array.isArray(round.answers) || round.answers.length === 0) return false;
    return round.answers.every((ans) => ans && typeof ans.text === "string" && Number.isFinite(Number(ans.points)));
  });
}

function buildPersistencePayload() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    stageQuestions: cloneQuestions(STAGE_QUESTIONS),
    stageEstimation: JSON.parse(JSON.stringify(STAGE_ESTIMATION))
  };
}

function savePersistentData() {
  try {
    localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(buildPersistencePayload()));
  } catch (_) {
    // ignore storage quota or privacy errors
  }
}

function hydratePersistentData() {
  try {
    const raw = localStorage.getItem(PERSISTENCE_KEY);
    if (!raw) return false;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;

    let applied = false;
    const storedQuestions = parsed.stageQuestions;
    const storedEstimation = parsed.stageEstimation;

    if (storedQuestions && typeof storedQuestions === "object") {
      STAGE_OPTIONS.forEach((targetStage) => {
        const data = storedQuestions[targetStage];
        if (validateQuestionsData(data)) {
          setQuestionsForStage(targetStage, data);
          applied = true;
        }
      });
    }

    if (storedEstimation && typeof storedEstimation === "object") {
      STAGE_OPTIONS.forEach((targetStage) => {
        const prompt = storedEstimation[targetStage];
        if (validateEstimationPrompt(prompt)) {
          setEstimationPromptForStage(targetStage, prompt);
          applied = true;
        }
      });
    }

    return applied;
  } catch (_) {
    return false;
  }
}

function hydrateQuestionsFromStorage() {
  try {
    hydratePersistentData();
    STAGE_OPTIONS.forEach((targetStage) => {
      const rawQuestions = localStorage.getItem(getQuestionStorageKey(targetStage));
      if (rawQuestions) {
        const parsedQuestions = JSON.parse(rawQuestions);
        if (validateQuestionsData(parsedQuestions)) setQuestionsForStage(targetStage, parsedQuestions);
      }

      const rawEstimation = localStorage.getItem(getEstimationStorageKey(targetStage));
      if (rawEstimation) {
        const parsedEstimation = JSON.parse(rawEstimation);
        if (validateEstimationPrompt(parsedEstimation)) setEstimationPromptForStage(targetStage, parsedEstimation);
      }
    });

    const legacy = localStorage.getItem(QUESTIONS_STORAGE_KEY);
    if (legacy && !localStorage.getItem(getQuestionStorageKey(1))) {
      const parsedLegacy = JSON.parse(legacy);
      if (validateQuestionsData(parsedLegacy)) setQuestionsForStage(1, parsedLegacy);
    }
  } catch (_) {
    // ignore invalid storage
  }

  savePersistentData();
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function normalizeGoogleSheetCsvUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";

  try {
    const url = new URL(value);
    const isGoogleSheet = /docs\.google\.com$/i.test(url.hostname) && url.pathname.includes('/spreadsheets/d/');
    if (!isGoogleSheet) return url.toString();

    const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match) return "";
    const gid = url.searchParams.get('gid') || '0';
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
  } catch (_) {
    return "";
  }
}

function normalizeHeaderValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getHeaderIndex(headers, aliases) {
  for (let i = 0; i < headers.length; i++) {
    if (aliases.includes(headers[i])) return i;
  }
  return -1;
}

function getCellValue(row, index) {
  if (!Array.isArray(row) || index < 0 || index >= row.length) return "";
  return String(row[index] || "").trim();
}

function isQuestionHeader(value) {
  return ["question", "pitanje", "pitanja"].includes(value);
}

function isAnswerHeader(value) {
  return ["answer", "odgovor", "odgovori"].includes(value);
}

function isPointsHeader(value) {
  return ["points", "poeni", "score", "bodovi", "bodovi%"].includes(value);
}

function resolveHeaderRowIndex(rows) {
  for (let r = 0; r < rows.length; r++) {
    const headerRow = (rows[r] || []).map(normalizeHeaderValue);
    const questionCount = headerRow.filter((value) => isQuestionHeader(value)).length;
    const hasAnswer = headerRow.some((value) => isAnswerHeader(value));
    if (questionCount > 1 || (questionCount >= 1 && hasAnswer)) return r;
  }
  return 0;
}

function resolveStageFromLabel(rawLabel) {
  const label = normalizeHeaderValue(rawLabel);
  if (!label) return null;
  if (label.includes("prva") || label.includes("game one") || label.includes("igra 1")) return 1;
  if (label.includes("druga") || label.includes("game two") || label.includes("igra 2")) return 2;
  if (label.includes("finale") || label.includes("final")) return 3;
  if (label === "1") return 1;
  if (label === "2") return 2;
  if (label === "3") return 3;
  return null;
}

function parseOptionalPoints(rawValue) {
  const raw = String(rawValue || "").trim().replace(',', '.');
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function generateLogicalAutoPoints(answerCount) {
  const count = Math.max(0, Number(answerCount) || 0);
  if (count === 0) return [];
  if (count === 1) return [100];
  const weights = [];
  let current = 1 + Math.random() * 0.45;
  for (let i = 0; i < count; i++) {
    if (i > 0) current = Math.max(0.06, current - (0.08 + Math.random() * 0.2));
    weights.push(current);
  }
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let points = weights.map((w) => Math.max(1, Math.round((w / totalWeight) * 100)));
  for (let i = 1; i < points.length; i++) {
    if (points[i] > points[i - 1]) points[i] = points[i - 1];
    if (points[i] < 1) points[i] = 1;
  }
  let diff = 100 - points.reduce((sum, p) => sum + p, 0);
  if (diff > 0) points[0] += diff;
  else if (diff < 0) {
    diff = Math.abs(diff);
    for (let i = points.length - 1; i >= 0 && diff > 0; i--) {
      const removable = Math.max(0, points[i] - 1);
      const take = Math.min(removable, diff);
      points[i] -= take;
      diff -= take;
    }
  }
  return points;
}

function normalizeAnswersWithPoints(answerTexts, pointCandidates) {
  const limitedAnswers = answerTexts.slice(0, 8);
  const limitedPoints = pointCandidates.slice(0, limitedAnswers.length);
  const validPointsCount = limitedPoints.filter((value) => Number.isFinite(value) && value >= 0).length;
  const finalPoints = (validPointsCount === limitedAnswers.length && validPointsCount > 0)
    ? limitedPoints.map((value) => Math.round(value))
    : generateLogicalAutoPoints(limitedAnswers.length);

  return limitedAnswers.map((text, index) => ({
    text,
    points: finalPoints[index]
  }));
}

function parseMultiStageColumnLayout(rows, headerRowIndex) {
  const headerRow = (rows[headerRowIndex] || []).map(normalizeHeaderValue);
  const stageLabelRow = headerRowIndex > 0 ? (rows[headerRowIndex - 1] || []) : [];
  const dataStartRow = headerRowIndex + 1;
  const questionBlocks = [];
  let estimationBlock = null;

  for (let col = 0; col < headerRow.length; col++) {
    if (!isQuestionHeader(headerRow[col])) continue;
    const stageLabel = getCellValue(stageLabelRow, col);
    const answerCol = isAnswerHeader(headerRow[col + 1]) ? col + 1 : -1;
    const pointsCol = isPointsHeader(headerRow[col + 2]) ? col + 2 : -1;
    const stageNumber = resolveStageFromLabel(stageLabel);
    const normalizedStageLabel = normalizeHeaderValue(stageLabel);
    const isEstimationColumn = normalizedStageLabel.includes("procjen") || normalizedStageLabel.includes("procena") || normalizedStageLabel.includes("estimate");

    if (isEstimationColumn) {
      estimationBlock = { questionCol: col, answerCol };
      continue;
    }

    questionBlocks.push({ questionCol: col, answerCol, pointsCol, stageNumber });
  }

  if (questionBlocks.length < 2) return null;

  const freeStages = [1, 2, 3];
  questionBlocks.forEach((block, index) => {
    if (block.stageNumber && freeStages.includes(block.stageNumber)) {
      freeStages.splice(freeStages.indexOf(block.stageNumber), 1);
      return;
    }
    block.stageNumber = freeStages.length > 0 ? freeStages.shift() : ((index % 3) + 1);
  });

  const questionsByStage = { 1: [], 2: [], 3: [] };
  const estimationByStage = { 1: null, 2: null, 3: null };

  questionBlocks.forEach((block) => {
    let currentQuestion = "";
    let currentAnswers = [];
    let currentPoints = [];

    const flushCurrent = () => {
      if (!currentQuestion || currentAnswers.length === 0) return;
      questionsByStage[block.stageNumber].push({
        question: currentQuestion,
        multiplier: 1,
        answers: normalizeAnswersWithPoints(currentAnswers, currentPoints)
      });
    };

    for (let r = dataStartRow; r < rows.length; r++) {
      const row = rows[r] || [];
      const questionValue = getCellValue(row, block.questionCol);
      const answerValue = block.answerCol >= 0 ? getCellValue(row, block.answerCol) : "";
      const pointsValueRaw = block.pointsCol >= 0 ? getCellValue(row, block.pointsCol) : "";
      const parsedPoints = parseOptionalPoints(pointsValueRaw);

      if (questionValue) {
        flushCurrent();
        currentQuestion = questionValue;
        currentAnswers = [];
        currentPoints = [];
      }

      if (!currentQuestion) continue;
      if (answerValue) {
        currentAnswers.push(answerValue);
        currentPoints.push(parsedPoints);
      }
    }

    flushCurrent();
  });

  if (estimationBlock && estimationBlock.answerCol >= 0) {
    const estimationStageOrder = [1, 2, 3];
    let estimationIndex = 0;
    for (let r = dataStartRow; r < rows.length && estimationIndex < estimationStageOrder.length; r++) {
      const row = rows[r] || [];
      const questionValue = getCellValue(row, estimationBlock.questionCol);
      const answerValue = getCellValue(row, estimationBlock.answerCol);
      if (!questionValue && !answerValue) continue;
      if (!questionValue || !answerValue) {
        throw new Error(`Red ${r + 1}: pitanje procjene mora imati i pitanje i odgovor.`);
      }
      estimationByStage[estimationStageOrder[estimationIndex]] = { question: questionValue, answer: answerValue };
      estimationIndex += 1;
    }
  }

  const hasAnyQuestion = STAGE_OPTIONS.some((targetStage) => questionsByStage[targetStage].length > 0);
  if (!hasAnyQuestion) return null;

  return { questionsByStage, estimationByStage };
}

function parseImportedSheetData(rows, fallbackEstimationPrompt) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("Google Sheet nema dovoljno podataka za uvoz.");

  const headerRowIndex = resolveHeaderRowIndex(rows);
  const dataStartRow = headerRowIndex + 1;
  const headers = (rows[headerRowIndex] || []).map(normalizeHeaderValue);
  const multiStageLayout = parseMultiStageColumnLayout(rows, headerRowIndex);

  if (multiStageLayout) {
    const stageQuestions = multiStageLayout.questionsByStage;
    const estimationByStage = {};
    STAGE_OPTIONS.forEach((targetStage) => {
      estimationByStage[targetStage] = validateEstimationPrompt(multiStageLayout.estimationByStage && multiStageLayout.estimationByStage[targetStage])
        ? multiStageLayout.estimationByStage[targetStage]
        : getEstimationPrompt(targetStage);
      if (stageQuestions[targetStage] && !validateQuestionsData(stageQuestions[targetStage])) {
        throw new Error(`Neispravan format pitanja za igru ${targetStage}.`);
      }
    });

    return { questionsByStage: stageQuestions, estimationByStage };
  }

  const questionIdx = getHeaderIndex(headers, ["question", "pitanje", "pitanja"]);
  const answerIdx = getHeaderIndex(headers, ["answer", "odgovor", "odgovori"]);
  const pointsIdx = getHeaderIndex(headers, ["points", "poeni", "score", "bodovi"]);
  const typeIdx = getHeaderIndex(headers, ["type", "tip"]);
  const roundIdx = getHeaderIndex(headers, ["round", "runda", "pitanje_broj", "broj_pitanja"]);
  const orderIdx = getHeaderIndex(headers, ["order", "redoslijed", "redosled", "sort"]);

  if (questionIdx === -1) throw new Error("CSV mora imati kolonu question/pitanje.");

  let estimationPrompt = (fallbackEstimationPrompt && validateEstimationPrompt(fallbackEstimationPrompt))
    ? { question: fallbackEstimationPrompt.question, answer: fallbackEstimationPrompt.answer }
    : null;

  const isWideFormat = answerIdx === -1 || pointsIdx === -1;
  if (isWideFormat) {
    const reserved = new Set([questionIdx, typeIdx, roundIdx, orderIdx].filter((idx) => idx >= 0));
    const answerColumnIndexes = [];
    for (let col = 0; col < headers.length; col++) {
      if (!reserved.has(col)) answerColumnIndexes.push(col);
    }
    if (answerColumnIndexes.length === 0) throw new Error("Nema kolona sa odgovorima. Dodaj kolone desno od pitanja.");

    const parsedQuestions = [];
    for (let i = dataStartRow; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      const typeRaw = getCellValue(row, typeIdx).toLowerCase();
      const question = getCellValue(row, questionIdx);
      if (!question && answerColumnIndexes.every((idx) => !getCellValue(row, idx)) && !typeRaw) continue;

      const isEstimation = ["estimation", "estimate", "procjena", "procena"].includes(typeRaw);
      const answersRaw = answerColumnIndexes.map((idx) => getCellValue(row, idx)).filter((value) => value.length > 0);

      if (isEstimation) {
        const estimationAnswer = answersRaw[0] || "";
        if (!question || !estimationAnswer) throw new Error(`Red ${i + 1}: procjena mora imati pitanje i prvi odgovor.`);
        estimationPrompt = { question, answer: estimationAnswer };
        continue;
      }

      if (!question) throw new Error(`Red ${i + 1}: nedostaje pitanje.`);
      if (answersRaw.length === 0) throw new Error(`Red ${i + 1}: pitanje mora imati barem jedan odgovor.`);

      const limitedAnswers = answersRaw.slice(0, 8);
      const autoPoints = generateLogicalAutoPoints(limitedAnswers.length);
      parsedQuestions.push({
        question,
        multiplier: 1,
        answers: limitedAnswers.map((text, idx) => ({ text, points: autoPoints[idx] }))
      });
    }

    if (!validateQuestionsData(parsedQuestions)) throw new Error("Uvezeni podaci nisu validni.");
    return {
      questions: parsedQuestions,
      estimation: (estimationPrompt && validateEstimationPrompt(estimationPrompt)) ? estimationPrompt : getEstimationPrompt(editorSelectedStage)
    };
  }

  const grouped = new Map();
  let orderCounter = 0;
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const typeRaw = getCellValue(row, typeIdx).toLowerCase();
    const question = getCellValue(row, questionIdx);
    const answer = getCellValue(row, answerIdx);
    const pointsRaw = getCellValue(row, pointsIdx);
    const roundValue = getCellValue(row, roundIdx);
    const orderValue = getCellValue(row, orderIdx);

    if (!question && !answer && !pointsRaw && !typeRaw) continue;

    const isEstimation = ["estimation", "estimate", "procjena", "procena"].includes(typeRaw);
    if (isEstimation) {
      if (!question || !answer) throw new Error(`Red ${i + 1}: procjena mora imati pitanje i odgovor.`);
      estimationPrompt = { question, answer };
      continue;
    }

    if (!question) throw new Error(`Red ${i + 1}: nedostaje pitanje.`);
    if (!answer) throw new Error(`Red ${i + 1}: nedostaje odgovor.`);

    const pointsValue = parseOptionalPoints(pointsRaw);
    if (pointsValue === null && String(pointsRaw || "").trim() !== "") throw new Error(`Red ${i + 1}: poeni moraju biti broj 0 ili vece.`);

    const groupingKey = roundValue ? `round:${roundValue}` : `question:${question.toLowerCase()}`;
    if (!grouped.has(groupingKey)) {
      const parsedOrder = Number(orderValue);
      grouped.set(groupingKey, {
        question,
        multiplier: 1,
        answers: [],
        sortOrder: Number.isFinite(parsedOrder) ? parsedOrder : orderCounter++
      });
    }

    grouped.get(groupingKey).answers.push({ text: answer, points: pointsValue });
  }

  const parsedQuestions = Array.from(grouped.values())
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      question: item.question,
      multiplier: item.multiplier,
      answers: normalizeAnswersWithPoints(
        item.answers.slice(0, 8).map((ans) => ans.text),
        item.answers.slice(0, 8).map((ans) => ans.points)
      )
    }));

  if (!validateQuestionsData(parsedQuestions)) {
    throw new Error("Uvezeni podaci nisu validni. Provjeri da svako pitanje ima bar jedan odgovor.");
  }

  return {
    questions: parsedQuestions,
    estimation: (estimationPrompt && validateEstimationPrompt(estimationPrompt)) ? estimationPrompt : getEstimationPrompt(editorSelectedStage)
  };
}

async function importQuestionsFromGoogleSheet() {
  if (IS_PROJECTION || transitionInProgress || pendingStageContinue) return;

  const input = document.getElementById("questionImportUrl");
  const importButton = document.querySelector(".editor-import-row button");
  if (!input) return;

  const csvUrl = normalizeGoogleSheetCsvUrl(input.value);
  if (!csvUrl) {
    alert("Unesi ispravan Google Sheet link.");
    return;
  }

  try {
    if (importButton) importButton.disabled = true;
    const response = await fetch(csvUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Ne mogu preuzeti Google Sheet. Provjeri da je fajl javno dostupan.");

    const csvText = await response.text();
    const rows = parseCsvText(csvText);
    const parsed = parseImportedSheetData(rows, getEstimationPrompt(editorSelectedStage));

    if (parsed && parsed.questionsByStage) {
      STAGE_OPTIONS.forEach((targetStage) => {
        const importedQuestions = parsed.questionsByStage[targetStage];
        if (validateQuestionsData(importedQuestions)) {
          setQuestionsForStage(targetStage, importedQuestions);
          localStorage.setItem(getQuestionStorageKey(targetStage), JSON.stringify(importedQuestions));
        }

        const importedEstimation = parsed.estimationByStage && parsed.estimationByStage[targetStage];
        if (validateEstimationPrompt(importedEstimation)) {
          setEstimationPromptForStage(targetStage, importedEstimation);
          localStorage.setItem(getEstimationStorageKey(targetStage), JSON.stringify(importedEstimation));
        }
      });
    } else {
      setEstimationPromptForStage(editorSelectedStage, parsed.estimation);
      localStorage.setItem(getEstimationStorageKey(editorSelectedStage), JSON.stringify(parsed.estimation));
      setQuestionsForStage(editorSelectedStage, parsed.questions);
      localStorage.setItem(getQuestionStorageKey(editorSelectedStage), JSON.stringify(parsed.questions));
    }

    savePersistentData();
    renderQuestionEditorForm(editorSelectedStage);

    if (editorSelectedStage === stage) {
      roundIndex = 0;
      strikes = 0;
      roundPoints = 0;
      stealMode = false;
      revealed = [];
      if (estimationMode) {
        estimationRevealed = false;
        renderEstimationRound();
        publishState();
      } else {
        loadRound(false);
      }
    }

    alert(parsed && parsed.questionsByStage
      ? "Pitanja su uspjesno uvezena i rasporedjena po igrama (Prva/Druga/Finale)."
      : "Pitanja su uspjesno uvezena iz Google Sheet-a.");
  } catch (err) {
    alert(err && err.message ? err.message : "Neuspjesan uvoz pitanja.");
  } finally {
    if (importButton) importButton.disabled = false;
  }
}

function useExampleGoogleSheetLink() {
  const input = document.getElementById("questionImportUrl");
  if (!input) return;
  input.value = GOOGLE_SHEET_EXAMPLE_URL;
  input.focus();
}

function renderQuestionEditorForm(targetStage) {
  const container = document.getElementById("questionEditorForm");
  if (!container) return;

  const rounds = getQuestionsForStage(targetStage) || [];
  const estimationPrompt = getEstimationPrompt(targetStage);
  container.innerHTML = "";

  const estimationCard = document.createElement("section");
  estimationCard.className = "editor-question-card";
  estimationCard.dataset.editorType = "estimation";

  const estimationTitle = document.createElement("label");
  estimationTitle.className = "editor-question-title";
  estimationTitle.textContent = "Pitanje procjene";

  const estimationQuestionInput = document.createElement("input");
  estimationQuestionInput.type = "text";
  estimationQuestionInput.className = "editor-question-input editor-estimation-question";
  estimationQuestionInput.value = estimationPrompt.question || "";
  estimationQuestionInput.placeholder = "Unesi pitanje procjene";

  const estimationAnswerRow = document.createElement("div");
  estimationAnswerRow.className = "editor-answer-row";

  const estimationAnswerInput = document.createElement("input");
  estimationAnswerInput.type = "text";
  estimationAnswerInput.className = "editor-answer-input editor-estimation-answer";
  estimationAnswerInput.placeholder = "Odgovor procjene";
  estimationAnswerInput.value = estimationPrompt.answer || "";

  estimationAnswerRow.appendChild(estimationAnswerInput);
  estimationCard.appendChild(estimationTitle);
  estimationCard.appendChild(estimationQuestionInput);
  estimationCard.appendChild(estimationAnswerRow);
  container.appendChild(estimationCard);

  rounds.forEach((round, roundIndexLocal) => {
    const card = document.createElement("section");
    card.className = "editor-question-card";
    card.dataset.editorType = "round";
    card.dataset.multiplier = Number(round.multiplier) || 1;

    const questionLabel = document.createElement("label");
    questionLabel.className = "editor-question-title";
    questionLabel.textContent = `Pitanje ${roundIndexLocal + 1}`;

    const questionInput = document.createElement("input");
    questionInput.type = "text";
    questionInput.className = "editor-question-input";
    questionInput.value = round.question || "";
    questionInput.placeholder = "Unesi pitanje";

    card.appendChild(questionLabel);
    card.appendChild(questionInput);

    for (let i = 0; i < 8; i++) {
      const row = document.createElement("div");
      row.className = "editor-answer-row";

      const answerInput = document.createElement("input");
      answerInput.type = "text";
      answerInput.className = "editor-answer-input";
      answerInput.placeholder = `Odgovor ${i + 1}`;
      answerInput.value = (round.answers && round.answers[i] && round.answers[i].text) ? round.answers[i].text : "";

      const pointsInput = document.createElement("input");
      pointsInput.type = "number";
      pointsInput.min = "0";
      pointsInput.step = "1";
      pointsInput.className = "editor-points-input";
      pointsInput.placeholder = "Broj ljudi";
      pointsInput.value = (round.answers && round.answers[i] && Number.isFinite(Number(round.answers[i].points))) ? String(round.answers[i].points) : "0";

      row.appendChild(answerInput);
      row.appendChild(pointsInput);
      card.appendChild(row);
    }

    container.appendChild(card);
  });
}

function collectQuestionEditorData() {
  const cards = Array.from(document.querySelectorAll('.editor-question-card[data-editor-type="round"]'));

  return cards.map((card, idx) => {
    const questionInput = card.querySelector(".editor-question-input");
    const question = (questionInput ? questionInput.value : "").trim();

    if (!question) {
      throw new Error(`Pitanje ${idx + 1} ne moze biti prazno.`);
    }

    const answerRows = Array.from(card.querySelectorAll(".editor-answer-row"));
    const answers = [];

    answerRows.forEach((row) => {
      const answerInput = row.querySelector(".editor-answer-input");
      const pointsInput = row.querySelector(".editor-points-input");
      const text = (answerInput ? answerInput.value : "").trim();
      const pointsNum = Number(pointsInput ? pointsInput.value : 0);
      const points = Number.isFinite(pointsNum) && pointsNum >= 0 ? Math.round(pointsNum) : 0;

      if (text) {
        answers.push({ text, points });
      }
    });

    if (answers.length === 0) {
      throw new Error(`Pitanje ${idx + 1} mora imati barem jedan odgovor.`);
    }

    const multiplier = Number(card.dataset.multiplier) || 1;
    return { question, multiplier, answers };
  });
}

function collectEstimationPromptEditorData() {
  const card = document.querySelector('.editor-question-card[data-editor-type="estimation"]');
  if (!card) {
    throw new Error("Nedostaje forma za pitanje procjene.");
  }

  const questionInput = card.querySelector(".editor-estimation-question");
  const answerInput = card.querySelector(".editor-estimation-answer");
  const question = (questionInput ? questionInput.value : "").trim();
  const answer = (answerInput ? answerInput.value : "").trim();

  if (!question) {
    throw new Error("Pitanje procjene ne moze biti prazno.");
  }

  if (!answer) {
    throw new Error("Odgovor procjene ne moze biti prazan.");
  }

  return { question, answer };
}

function onQuestionEditorStageChange(value) {
  const parsedStage = Number(value);
  editorSelectedStage = STAGE_OPTIONS.includes(parsedStage) ? parsedStage : 1;
  renderQuestionEditorForm(editorSelectedStage);
}

function openSettingsModal() {
  if (IS_PROJECTION || transitionInProgress || pendingStageContinue) return;
  const modal = document.getElementById("settingsModal");
  if (!modal) return;
  syncSoundSettingsUI();
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeSettingsModal() {
  const modal = document.getElementById("settingsModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function openQuestionEditor() {
  if (IS_PROJECTION || transitionInProgress || pendingStageContinue) return;
  const modal = document.getElementById("questionEditorModal");
  const stageSelect = document.getElementById("questionEditorStage");
  if (!modal || !stageSelect) return;

  editorSelectedStage = STAGE_OPTIONS.includes(stage) ? stage : 1;
  stageSelect.value = String(editorSelectedStage);
  renderQuestionEditorForm(editorSelectedStage);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function openQuestionEditorFromSettings() {
  closeSettingsModal();
  openQuestionEditor();
}

function closeQuestionEditor() {
  const modal = document.getElementById("questionEditorModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function saveQuestionEditor() {
  if (IS_PROJECTION || transitionInProgress || pendingStageContinue) return;

  try {
    const estimationParsed = collectEstimationPromptEditorData();
    if (!validateEstimationPrompt(estimationParsed)) {
      alert("Neispravan format pitanja procjene.");
      return;
    }

    const parsed = collectQuestionEditorData();
    if (!validateQuestionsData(parsed)) {
      alert("Neispravan format pitanja.");
      return;
    }

    setEstimationPromptForStage(editorSelectedStage, estimationParsed);
    localStorage.setItem(getEstimationStorageKey(editorSelectedStage), JSON.stringify(estimationParsed));

    setQuestionsForStage(editorSelectedStage, parsed);
    localStorage.setItem(getQuestionStorageKey(editorSelectedStage), JSON.stringify(parsed));
    savePersistentData();

    if (editorSelectedStage === stage) {
      roundIndex = 0;

      strikes = 0;
      roundPoints = 0;
      stealMode = false;
      revealed = [];

      if (estimationMode) {
        estimationRevealed = false;
        renderEstimationRound();
        publishState();
      } else {
        loadRound(false);
      }
    }

    closeQuestionEditor();
    alert("Pitanja su uspjesno sacuvana.");
  } catch (err) {
    alert(err && err.message ? err.message : "Podaci nisu ispravni.");
  }
}

function startGameFromIntro() {
  pendingStageContinue = null;
  pendingStageImage = null;
  pendingWinnerImage = null;
  gameStarted = true;
  const start = document.getElementById("startScreen");
  const root = document.getElementById("gameRoot");
  if (start) start.classList.add("hidden");
  if (root) root.classList.remove("hidden");

  const beginFirstStage = function () {
    startStageEstimation();
  };

  triggerProjectionStageWinner("", "pictures/prva.png", false);
  if (typeof window.runStageWinnerTransition === "function") {
    window.runStageWinnerTransition("", beginFirstStage, "pictures/prva.png", false);
  } else if (typeof window.runSpecialImageTransition === "function") {
    window.runSpecialImageTransition("pictures/prva.png", beginFirstStage);
  } else {
    beginFirstStage();
  }
}

function toggleControlMenu() {
  const menu = document.getElementById("controlMenu");
  if (!menu) return;
  menu.classList.toggle("hidden");
}

function goToStartScreen() {

  gameStarted = false;
  estimationMode = false;
  estimationRevealed = false;
  const start = document.getElementById("startScreen");
  const root = document.getElementById("gameRoot");
  if (root) root.classList.add("hidden");
  if (start) start.classList.remove("hidden");
  const menu = document.getElementById("controlMenu");
  if (menu) menu.classList.add("hidden");
  publishState();
}

window.toggleControlMenu = toggleControlMenu;
window.goToStartScreen = goToStartScreen;
window.startGameFromIntro = startGameFromIntro;
window.openProjection = openProjection;
window.updateSoundVolume = setSoundVolume;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.openQuestionEditor = openQuestionEditor;
window.openQuestionEditorFromSettings = openQuestionEditorFromSettings;
window.closeQuestionEditor = closeQuestionEditor;
window.saveQuestionEditor = saveQuestionEditor;
window.importQuestionsFromGoogleSheet = importQuestionsFromGoogleSheet;
window.useExampleGoogleSheetLink = useExampleGoogleSheetLink;
window.onQuestionEditorStageChange = onQuestionEditorStageChange;
window.chooseAdvantageTeam = chooseAdvantageTeam;
window.continueToNextStage = continueToNextStage;

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeQuestionEditor();
    closeSettingsModal();
  }
});

if (IS_PROJECTION) {
  document.body.classList.add("projection-mode");
  const start = document.getElementById("startScreen");
  const root = document.getElementById("gameRoot");
  if (start) start.classList.remove("hidden");
  if (root) root.classList.add("hidden");
}

hydrateQuestionsFromStorage();
setupSync();
updateControlVisibility();
if (!IS_PROJECTION) publishState();

if (IS_PROJECTION) {
  // Projection waits for synced state; if none arrives, keep empty board.
}




















