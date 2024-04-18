import { Scene } from "phaser"; // scenes are where the game logic is written for different parts of the game
import Phaser, { NONE } from "phaser";
import Player from "../../js/Player";
import io from "socket.io-client";
import "../../src/style.css";

export class Game extends Scene {
  constructor() {
    super("Game");
    this.arrows = [];
  }

  preload() {
    this.load.setPath("assets");

    // Loads all the sprite sheets
    this.load.tilemapTiledJSON("map", "map/battlefield.json"); //loads the battlefield.json file
    this.load.image("tiles", "map/battlefield.png"); //loads the battlefield.png file that the tile battlefiled.json file references
    this.load.spritesheet("player", "Archers-Character/Archers/Archer-1.png", {
      frameWidth: 64,
      frameHeight: 64,
    });

    this.load.image("arrow", "Archers-Character/Archers/arrow.png", {
      frameWidth: 32,
      frameHeight: 32,
    });
  }

  create(data) {
    this.gameId = data.gameId;
    this.playerId = data.socket.id;
    this.socket = data.socket;
    this.sock = this.socket;
    this.token = data.token;

    this.socket.emit("joinGameRoom", {
      gameId: this.gameId,
      playerId: this.playerId,
    });
    console.log(
      "gameConsoleLog: Systems check... this.gameId is:",
      this.gameId,
      "this.playerId is:",
      this.playerId
    );

    //adding collision to floors
    this.map = this.make.tilemap({
      key: "map",
      tileWidth: 12,
      tileHeight: 12,
    });

    //Creates the listener that waits for other player updates from the server
    this.socket.on("playerUpdates", (playerUpdated) => {
      //Creates the listener that waits for other player updates from the server
      this.renderPlayers(playerUpdated, this);
    });

    // Limits the amount of times that the game sends updates to the socket
    this.rate_limit = 1;
    this.rate_limit_count = 0;

    const screenWidth = this.cameras.main.width;
    const screenHeight = this.cameras.main.height;
    const scaleFactorX = screenWidth / this.map.widthInPixels;
    const scaleFactorY = screenHeight / this.map.heightInPixels;

    const backgroundImage = this.add.image(0, 0, "tiles").setOrigin(0); // creates a tilemap from the battlefield.json file
    backgroundImage.setScale(scaleFactorX, scaleFactorY);

    // Receive the valid spawn positions from the server, deconflicted for each player
    // TODO implement this code for randomized positions
    // WIP
    this.socket.on("validPositions", (positions) => {
      console.log("positions are:...", positions);
    });

    // CREATE and process player map and send to the server
    this.player = new Player(
      this,
      445,
      0,
      this.playerId,
      this.playerId,
      this.gameId
    );

    this.player.lives = 0;
    // Establishes the collision layer within the game. Had to be layered
    // on top of everything to ensure proper collision detection
    this.tileset = this.map.addTilesetImage("Tileset", "tiles");
    this.map.setCollisionBetween();
    this.collisionLayer = this.map.createLayer("collision", this.tileset, 0, 0);
    // console.log(this.collisionLayer)
    this.collisionLayer.setScale(scaleFactorX, scaleFactorY);
    this.collisionLayer.setCollisionByExclusion([-1]);
    this.collisionLayer.setCollisionByProperty({ collide: true });
    this.collisionLayer.setAlpha(0.6);

    // Extract tile indices from the collision layer
    this.tileIndices = [];
    this.collisionLayer.forEachTile((tile) => {
      this.tileIndices.push(tile.index);
    });

    // Extract other necessary information
    const tileWidth = this.collisionLayer.tileWidth;
    const tileHeight = this.collisionLayer.tileHeight;
    const mapWidth = this.collisionLayer.width;
    const mapHeight = this.collisionLayer.height;
    const scale = {
      x: this.collisionLayer.scaleX,
      y: this.collisionLayer.scaleY,
    };

    // for testing purpose
    this.player.setOrigin(0.5, 0.5);

    // resizing bouncing box
    this.newBoundingBoxWidth = 16;
    this.newBoundingBoxHeight = 15;
    this.offsetX = (this.player.width - this.newBoundingBoxWidth) / 2;
    this.offsetY = (this.player.height - this.newBoundingBoxHeight) / 1.5;

    // Set the new size of the bounding box
    this.player.body.setSize(
      this.newBoundingBoxWidth,
      this.newBoundingBoxHeight,
      true
    );

    // Reposition the bounding box relative to the player's center
    this.player.body.setOffset(this.offsetX, this.offsetY);
    // this.player.anims.play("idleLeft"); // *new entry test this

    // Reposition the bounding box relative to the player's center
    this.player.body.setOffset(this.offsetX, this.offsetY);

    this.playerArr = [];

    // Adds an collision listner between players and arrows
    this.physics.add.collider(
      this.arrows,
      this.player,
      this.arrowHitPlayer,
      null,
      this
    );

    // Sets up the arrow keys as the input buttons
    this.cursors = this.input.keyboard.createCursorKeys();
    this.cursors.space = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );

    //Sends the player to the server for storage/broadcast to other clients
    this.socket.emit("joinRoom", { player: this.player, gameId: this.gameId });

    // Listen for the event when another player joins the same room
    this.socket.on("playerInGameMap", (response) => {
      console.log(`${response.message}`);
    });

    // After receiving 'removeDeadPlayer' event:
    this.socket.on("removeDeadPlayer", (data) => {
      if (data.playerId === this.playerId) {
        this.player.respawn(); // Call respawn instead of game over
      } else {
        const otherPlayer = this.playerArr.find((p) => p.id === data.playerId);
        if (otherPlayer) {
          otherPlayer.respawn();
        }
      }
    });

    // Listen for playerShooting event from the server
    this.socket.on("playerShooting", (shootData) => {
      // console.log(shootData);
      this.createArrow(
        shootData.x,
        shootData.y,
        shootData.direction,
        shootData.playerId
      ); // call the createArrow function to recreate arrow sprite at the position received from the server
    });

    // Client-side in Game scene
    this.socket.on("removeDeadPlayer", (data) => {
      // Check if the dead player is the local player
      if (data.playerId === this.playerId) {
        // If so, stop all input events, animations, or movement the player may have
        this.player.disableBody(true, false);
        this.player.setVisible(false);

        // Now transition to the 'GameOver' scene or any other logic for when the player dies
        this.scene.start("GameOver");
      } else {
        // If it's another player, find them in your player array and destroy their character
        const otherPlayer = this.playerArr.find((p) => p.id === data.playerId);
        if (otherPlayer) {
          // otherPlayer.setVisible(false);
          // this.scene.start('GameOver');
          otherPlayer.destroy();
        }
      }
    });

    this.socket.on("playerRespawn", (data) => {
      let respawningPlayer = this.playerArr.find(
        (player) => player.id === data.playerId
      );
      if (respawningPlayer) {
        respawningPlayer.setPosition(data.position.x, data.position.y);
        respawningPlayer.setAlpha(1);
        respawningPlayer.setVisible(true);
        respawningPlayer.dead = false;
      }
    });

    // Initialize the timer text with a default value
    this.timerText = this.add
      .text(10, 10, "Time: 00:00", {
        font: "28px Arial",
        fill: "#ffffff",
      })
      .setScrollFactor(0); // Make sure the text does not scroll with the camera

    // Listen for timer updates
    this.socket.on("timerUpdate", (time) => {
      const minutes = Math.floor(time / 60);
      const seconds = time % 60;
      const formattedTime = `${minutes}:${seconds.toString().padStart(2, "0")}`;
      console.log(formattedTime);
      this.timerText.setText(`Time: ${formattedTime}`);
    });

    // Listen for the end game event
    this.socket.on("endGame", () => {
      console.log("Game Over, transitioning to GameOver scene.");
      this.scene.start("GameOver");
    });

    this.killDisplay = this.add.text(0, 16, `Killed: ${this.player.kills}`, {
      fontSize: "20px",
      fill: "#FFF",
    });

    this.killDisplay.setOrigin(1, 0);
    this.killDisplay.setX(this.cameras.main.width - 16);
  } //END Create

  // Create arrow sprite at the received position
  createArrow(x, y, direction, playerId) {
    let xOffset = direction === "left" ? 20 : 20; // Set the offset based on the direction to deconflict shooter and arrow
    let arrow = this.physics.add.sprite(x + xOffset, y, "arrow");
    arrow.shooterId = playerId;
    arrow.setActive(true).setVisible(true);
    arrow.setOrigin(0.5, 0.5);
    arrow.setScale(1);
    this.physics.world.enable(arrow);
    arrow.body.setSize(8, 3);
    if (direction === "left") {
      arrow.setVelocityX(-600); // Set arrow speed
      arrow.setFlipX(true); // Flip the arrow to face left
    } else {
      arrow.setVelocityX(600); // Set arrow speed
    }

    // Add to arrows array
    this.arrows.push(arrow);
  }

  // Arrow collision detection with player
  arrowHitPlayer(arrow, player) {
    console.log(`Arrow from ${arrow.shooterId} hit player.id of ${player.id}`);
    console.log("this.playerId is : ", this.playerId);
    console.log("this.player.id is : ", this.player.id);
    // if (!arrow.active || !player.active || !player.visible) {
    //   return;
    // }
    arrow.destroy();
    player.loseLife();
    // if shooter hit a different player add one
    if (arrow.shooterId && this.playerId) {
      this.player.kills++;
      console.log(
        `Updated kill count for ${this.playerId}: ${this.player.kills}`
      );
      this.updateKillDisplay();
    }
  }

  updateKillDisplay() {
    this.killDisplay.setText("Kills: " + this.player.kills);
  }

  createCursorsFromActiveKeys(activeKeys) {
    // debugger;
    return {
      up: this.input.keyboard.addKey(activeKeys.up),
      down: this.input.keyboard.addKey(activeKeys.down),
      left: this.input.keyboard.addKey(activeKeys.left),
      right: this.input.keyboard.addKey(activeKeys.right),
      spacebar: this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.SPACE
      ),
    };
  }

  // Renders the players based on the data from the server
  renderPlayers(playerData) {
    // console.log('playerData', playerData);
    if (playerData.id !== this.playerId) {
      let updateCursors = this.createCursorsFromActiveKeys(
        playerData.activeKeys
      );

      let updatePlayer = this.playerArr.find(
        (player) => player.id === playerData.id
      );
      // If the player doesnt exist in the client-side map, create it
      if (!updatePlayer) {
        updatePlayer = new Player(
          this,
          playerData.x,
          playerData.y,
          playerData.id,
          playerData.id
        );
        updatePlayer.setOrigin(0.5, 0.5);
        updatePlayer.setAlpha(1);
        updatePlayer.body.setSize(
          this.newBoundingBoxWidth,
          this.newBoundingBoxHeight,
          true
        );
        updatePlayer.body.setOffset(this.offsetX, this.offsetY);
        this.physics.add.collider(updatePlayer, this.collisionLayer);
        this.physics.add.existing(updatePlayer);
        this.playerArr.push(updatePlayer);
        // console.log(updatePlayer);
        // Otherwise, update the player with the given data
      } else {
        updatePlayer.setDirection(playerData.direction);
        updatePlayer.setPosition(playerData.x, playerData.y);
        updatePlayer.update(updateCursors);
        // console.log(this.playerArr);
      }
    }
  }

  update() {
    // Collision detection between the server emitted player and the collision layer
    this.physics.world.collide(
      this.player,
      this.collisionLayer,
      (player, tile) => {
        this.player.isGrounded = true;
      }
    );

    // Collision detection between the server emitted arrow and the collision layer
    this.arrows.forEach((arrow, index) => {
      if (
        arrow.active &&
        this.physics.world.collide(arrow, this.collisionLayer)
      ) {
        // console.log('arrow collided with the collision layer: ', arrow);
        arrow.destroy(); // Destroy the individual arrow
        this.arrows.splice(index, 1); // Remove the arrow from the array
      }
    });

    // Update the player with the current arrow key combinations/presses
    this.player.update(this.cursors);
    // Packages the keypresse into a json object for the server
    const activeKeys = {
      up: this.cursors.up.isDown,
      down: this.cursors.down.isDown,
      left: this.cursors.left.isDown,
      right: this.cursors.right.isDown,
      space: this.cursors.space.isDown,
    };

    // Sends pertinent information to the server
    this.socket.emit("clientPlayerUpdate", {
      gameId: this.gameId,
      id: this.playerId,
      playerX: this.player.x,
      playerY: this.player.y,
      activeKeys: activeKeys,
      direction: this.player.direction,
    });
  }
}

// Function to get the player ID from the server before starting the game
async function getPlayerIdFromSocket() {
  return new Promise((resolve, reject) => {
    // Listen for player ID response from the server
    this.sock.once("playerIdRes", (pid) => {
      resolve(pid); // Resolve the promise with the player ID
    });

    // Request player ID from the server
    this.sock.emit("playerIdReq");
  });
}

// Function that sets the received playerID
async function setClientPlayerId() {
  try {
    const hold = await getPlayerIdFromSocket();
    this.playerId = hold;
    console.log("Received player ID:", this.playerId);
  } catch (error) {
    console.error("Error:", error);
  }
}
