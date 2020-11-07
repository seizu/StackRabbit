import { PieceSelector } from "./piece_selector.js";
import { BoardLoader } from "./board_loader.js";
import { Canvas } from "./canvas.js";
import {
  NUM_ROW,
  NUM_COLUMN,
  VACANT,
  GRAVITY,
  REWARDS,
  GameState,
  LINE_CLEAR_DELAY,
} from "./constants.js";
import { Piece } from "./piece.js";
import { InputManager } from "./input_manager.js";
import { BoardEditManager } from "./board_edit_manager.js";

const scoreTextElement = document.getElementById("score-display");
const linesTextElement = document.getElementById("lines-display");
const levelTextElement = document.getElementById("level-display");
const headerTextElement = document.getElementById("header-text");
const debugTextElement = document.getElementById("debug");
const statsTextElement = document.getElementById("stats");
const gameOptionsForm = document.getElementById("game-options-form");
const startGameButton = document.getElementById("start-game");
const restartGameButton = document.getElementById("restart-game");
const levelSelectElement = document.getElementById("level-select");
const mainCanvas = document.getElementById("main-canvas");

// 0 is empty space, 1 is T piece color, 2 is L piece color, 3 is J piece color
export const SquareState = {
  EMPTY: 0,
  COLOR1: 1,
  COLOR2: 2,
  COLOR3: 3,
};

// Create the initial empty board
let m_board = [];
for (let r = 0; r < NUM_ROW; r++) {
  m_board[r] = [];
  for (let c = 0; c < NUM_COLUMN; c++) {
    m_board[r][c] = SquareState.EMPTY;
  }
}

let m_inputManager;
let m_canvas = new Canvas(m_board);
let m_boardEditManager = new BoardEditManager(m_board, m_canvas);
let m_pieceSelector = new PieceSelector();
let m_boardLoader = new BoardLoader(m_board, m_canvas);
let m_currentPiece;
let m_nextPiece;

let m_level;
let m_lines;
let m_gameState;
let m_score;
let m_gravityFrameCount;
let m_ARE;
let m_lineClearDelay;
let m_linesPendingClear;

// Exported methods that allow other classes to access the variables in this file

export const GetCurrentPiece = () => {
  return m_currentPiece;
};

export const GetLevel = () => {
  return m_level;
};

function refreshHeaderText() {
  let newText = "";
  switch (m_gameState) {
    case GameState.START_SCREEN:
      newText = "Welcome to Tetris Trainer!";
      break;
    case GameState.RUNNING:
      newText = "";
      break;
    case GameState.GAME_OVER:
      newText = "Game over!";
      break;
    case GameState.PAUSED:
      newText = "Paused";
      break;
  }
  headerTextElement.innerText = newText;
}

function refreshDebugText() {
  debugTextElement.innerText = m_inputManager.getDebugText();
}

function refreshStats() {
  // Calculate parity, where the top left square is "1" and adjacent squares are "-1"
  let parity = 0;
  for (let r = 0; r < NUM_ROW; r++) {
    for (let c = 0; c < NUM_COLUMN; c++) {
      if (m_board[r][c] != SquareState.EMPTY) {
        // Add 1 or -1 to parity total based on the square's location
        const cellConstant = (r + c) % 2 == 0 ? 1 : -1;
        parity += cellConstant;
      }
    }
  }

  statsTextElement.innerText = "Parity: " + parity;
}

function getFullRows() {
  let fullLines = [];
  for (let r = 0; r < NUM_ROW; r++) {
    let isRowFull = true;
    for (let c = 0; c < NUM_COLUMN; c++) {
      if (m_board[r][c] == SquareState.EMPTY) {
        isRowFull = false;
        break;
      }
    }
    if (isRowFull) {
      fullLines.push(r);
    }
  }
  return fullLines;
}

function removeFullRows() {
  for (const r of m_linesPendingClear) {
    // Move down all the rows above it
    for (let y = r; y > 1; y--) {
      for (let c = 0; c < NUM_COLUMN; c++) {
        m_board[y][c] = m_board[y - 1][c];
      }
    }
    // Clear out the very top row (newly shifted into the screen)
    for (let c = 0; c < NUM_COLUMN; c++) {
      m_board[0][c] = SquareState.EMPTY;
    }
  }
  const numLinesCleared = m_linesPendingClear.length;
  if (numLinesCleared > 0) {
    // Update the board
    m_canvas.drawBoard();

    // Update the score
    m_score += REWARDS[numLinesCleared] * (m_level + 1);
    m_lines += numLinesCleared;
    refreshScoreHUD();
  }
  m_linesPendingClear = [];
}

function checkForGameOver() {
  // If the current piece collides with the existing board as it spawns in, you die
  const currentTetromino = m_currentPiece.activeTetromino;
  for (let r = 0; r < currentTetromino.length; r++) {
    for (let c = 0; c < currentTetromino[r].length; c++) {
      if (
        currentTetromino[r][c] &&
        m_board[m_currentPiece.y + r][m_currentPiece.x + c]
      ) {
        m_gameState = GameState.GAME_OVER;
        refreshHeaderText();
        return;
      }
    }
  }
}

function getNewPiece() {
  m_currentPiece = m_nextPiece;

  checkForGameOver();

  // Piece status is drawn first since the read index increments when the next
  // piece is selected
  m_canvas.drawPieceStatusString(m_pieceSelector.getStatusString());
  m_nextPiece = new Piece(
    m_pieceSelector.chooseNextPiece(m_currentPiece.id),
    m_board
  );
  // Draw the new piece in the next box
  m_canvas.drawNextBox(m_nextPiece);
}

function resetLocalVariables() {
  m_score = 0;
  m_gravityFrameCount = 0;
  m_ARE = 0;
  m_lineClearDelay = 0;
  m_linesPendingClear = [];
  m_lines = 0;
  m_level = 0;
  m_gameState = GameState.START_SCREEN;
  m_inputManager.resetLocalVariables();
}

function startGame() {
  // Reset game values
  resetLocalVariables();
  m_ARE = 30; // Extra delay for first piece
  m_pieceSelector.startReadingPieceSequence();
  m_boardLoader.resetBoard();
  m_gameState = GameState.RUNNING;

  // Parse the level
  const levelSelected = parseInt(levelSelectElement.value);
  if (Number.isInteger(levelSelected) && levelSelected > 0) {
    m_level = levelSelected;
  } else {
    m_level = 0;
  }

  // Get the first piece and put it in the next piece slot. Will be bumped to current in getNewPiece()
  m_nextPiece = new Piece(m_pieceSelector.chooseNextPiece(""), m_board);
  getNewPiece();

  // Refresh UI
  m_canvas.drawBoard();
  m_canvas.drawCurrentPiece();
  refreshHeaderText();
}

function onLineClearStateEnded() {}

function onAREStateEnded() {
  m_canvas.drawCurrentPiece();
}

function updateGameState() {
  if (m_lineClearDelay < 0 || m_ARE < 0) {
    throw new Error("Negative line clear or ARE");
  }

  if (m_gameState == GameState.LINE_CLEAR && m_lineClearDelay == 0) {
    m_gameState = GameState.ARE;
    onLineClearStateEnded();
  } else if (m_gameState == GameState.ARE && m_ARE == 0) {
    m_gameState = GameState.RUNNING;
    onAREStateEnded();
  } else if (m_gameState == GameState.RUNNING) {
    if (m_lineClearDelay > 0) {
      m_gameState = GameState.LINE_CLEAR;
    } else if (m_ARE > 0) {
      m_gameState = GameState.ARE;
    }
  }
}

// 60 FPS game loop
function gameLoop() {
  switch (m_gameState) {
    case GameState.LINE_CLEAR:
      // Still animating line clear
      m_lineClearDelay -= 1;
      // Do subtraction so animation frames count up
      m_canvas.drawLineClears(
        m_linesPendingClear,
        LINE_CLEAR_DELAY - m_lineClearDelay
      );
      if (m_lineClearDelay == 0) {
        // Clear the lines for real and shift stuff down
        removeFullRows();
      }
      break;

    case GameState.ARE:
      // Waiting for next piece
      m_ARE -= 1;
      break;

    case GameState.RUNNING:
      // Handle inputs
      m_inputManager.handleInputsThisFrame();

      // Handle gravity
      if (m_inputManager.getIsSoftDropping()) {
        // Reset gravity for if they stop soft dropping
        m_gravityFrameCount = 0;
      } else {
        // Increment gravity and shift down if appropriate
        m_gravityFrameCount += 1;

        // Move the piece down when appropriate
        if (m_gravityFrameCount >= GRAVITY[m_level]) {
          moveCurrentPieceDown();
          m_gravityFrameCount = 0;
        }
      }

      // Refresh displays
      refreshDebugText();
      refreshStats();

      break;
  }

  updateGameState();

  window.setTimeout(gameLoop, 16.67);

  // Slo-mo testing
  // window.setTimeout(gameLoop, 50);
}

function refreshScoreHUD() {
  scoreTextElement.innerText = "Score: " + m_score;
  linesTextElement.innerText = "Lines: " + m_lines;
  levelTextElement.innerText = "Level: " + m_level;
}

/** Delegate functions to controls code */

function movePieceLeft() {
  m_canvas.unDrawCurrentPiece();
  const didMove = m_currentPiece.moveLeft();
  m_canvas.drawCurrentPiece();
  return didMove;
}

/** @returns whether the piece moved */
function movePieceRight() {
  m_canvas.unDrawCurrentPiece();
  const didMove = m_currentPiece.moveRight();
  m_canvas.drawCurrentPiece();
  return didMove;
}

/** @returns whether the piece moved */
function moveCurrentPieceDown() {
  if (m_currentPiece.shouldLock()) {
    // Lock in piece and re-render the board
    const lockHeight = m_currentPiece.getHeightFromBottom();
    m_currentPiece.lock();
    m_canvas.drawBoard();

    // Get a new piece but --don't render it-- till after ARE
    getNewPiece();

    // Clear lines
    m_linesPendingClear = getFullRows();
    if (m_linesPendingClear.length > 0) {
      m_lineClearDelay = LINE_CLEAR_DELAY; // Clear delay counts down from max val
    }

    // Get the ARE based on piece lock height
    /* ARE (frame delay before next piece) is 10 frames for 0-2 height, then an additional 
      2 frames for each group of 4 above that.
        E.g. 9 high would be: 10 + 2 + 2 = 14 frames */
    m_ARE = 10 + Math.floor((lockHeight + 2) / 4) * 2;

    return false; // Return false because the piece didn't shift down
  } else {
    // Move down as usual
    m_canvas.unDrawCurrentPiece();
    m_currentPiece.moveDown();
    m_canvas.drawCurrentPiece();
    return true; // Return true because the piece moved down
  }
}

function rotatePieceLeft() {
  m_canvas.unDrawCurrentPiece();
  m_currentPiece.rotate(false);
  m_canvas.drawCurrentPiece();
}

function rotatePieceRight() {
  m_canvas.unDrawCurrentPiece();
  m_currentPiece.rotate(true);
  m_canvas.drawCurrentPiece();
}

function togglePause() {
  if (m_gameState == GameState.RUNNING) {
    m_gameState = GameState.PAUSED;
    refreshHeaderText();
  } else if (m_gameState == GameState.PAUSED) {
    m_gameState = GameState.RUNNING;
    refreshHeaderText();
  }
}

function getGameState() {
  return m_gameState;
}

function getARE() {
  return m_ARE;
}

/**
 * SCRIPT START
 */
m_inputManager = new InputManager(
  moveCurrentPieceDown,
  movePieceLeft,
  movePieceRight,
  rotatePieceLeft,
  rotatePieceRight,
  togglePause,
  getGameState,
  getARE
);

mainCanvas.addEventListener("mousedown", function (e) {
  m_boardEditManager.onMouseDown(e);
});
mainCanvas.addEventListener("mousemove", function (e) {
  m_boardEditManager.onMouseDrag(e);
});
mainCanvas.addEventListener("mouseup", function (e) {
  m_boardEditManager.onMouseUp(e);
});

document.addEventListener("keydown", (e) => {
  m_inputManager.keyDownListener(e);
});
document.addEventListener("keyup", (e) => {
  m_inputManager.keyUpListener(e);
});

gameOptionsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  startGameButton.focus();
  startGame();
});

resetLocalVariables();
m_canvas.drawBoard();
refreshHeaderText();
gameLoop();
