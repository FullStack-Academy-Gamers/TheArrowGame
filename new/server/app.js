require("dotenv").config();
const express = require("express");
const app = express();
const http = require("http"); 
const socketIO = require("socket.io"); 
const path = require("path");
const morgan = require("morgan");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = process.env; 
const cors = require('cors');

const PORT = process.env.PORT || 3000;

// Enable CORS middleware
app.use(cors({
  origin: 'http://localhost:1234'
}));

// Serve static files from the "client" directory
app.use(express.static(path.join(__dirname, "..", "public"))); // Refactoring may be required for the client directory path

// Create an HTTP server instance
const server = http.createServer(app);

// Logging middleware 
app.use(morgan("dev"));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Authorization middleware 
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer")) {
    const token = authHeader.slice(7, authHeader.length); // Extract the token

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded; // Set decoded user information on request
    } catch (error) {
      console.error(error);
      // Optionally handle specific error cases here (e.g., token expired)
      // For security reasons, you might not want to send specific error messages to the client
    }
  }
  // Proceed without setting req.user if no valid token was provided
  next();
});

// Backend routes 
app.use("/auth", require("./auth"));
app.use("/api", require("./api"));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).send(err.message || "Internal server error.");
});

// Default to 404 if no other route matched
app.use((req, res) => {
  res.status(404).send("Not found.");
});

// Socket.io connection
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const players = new Map(); // Map to store player information - recieves player instances from line "playerConnect"

const gameStates = {};

// Once the game Scene socket is created, server will listen for the following events
io.on('connection', (socket) => {

// Get the map data and determine valid positions for player spawns
  socket.on('mapData', ({ tileIndices, tileWidth, tileHeight, mapWidth, mapHeight, scale }) => {
    // Reconstruct collision layer based on tile indices
    // Perform calculations to determine valid spawn locations

    const validSpawnLocations = [];

    for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
            const tileIndex = tileIndices[y * mapWidth + x];
            console.log(`Tile: ${tileIndex}`);
            // Assuming tile index -1 represents no collision
            if (tileIndex === -1) {
                // Calculate position of tile in world coordinates
                const posX = x * tileWidth * scale.x;
                const posY = y * tileHeight * scale.y;

                // console.log(`Position ${posX} ${posY}`)

                let valid = true;
                for (const [id, playerObject] of players.entries()) {
                    // console.log(playerObject)
                    if (posX === playerObject.x || posY === playerObject.y) {
                        valid = false;
                        break; // Exit the loop early if collision is found

                    // Add position to valid spawn locations
                    }
                  }
                if(valid){
                  validSpawnLocations.push({ x: posX, y: posY });
                }
              }
            }
          }
    // Emit valid spawn locations back to the client
    socket.emit('validPositions', validSpawnLocations);
  });

  socket.on('playerIdReq', () => {
    const pid = socket.id;
    if(!players.has(pid)){
      socket.emit('playerIdRes', (pid));
    }
})

    // Listen for player connection from client and 
    socket.on('joinRoom', (data) => {

      const player = data.player; 
      const gameId = data.gameId; 


      // Stores new player information into players Map using player.id as the key. 
      // The line below allows the server to keep track of all players by placing the player object within the Map defined near line 74 
      players.set(player.id, player); 
       // Join the player to the room
      socket.join(gameId);
      // console.log('player', player);

      // Broadcast to all the clients that a new player has joined, along with the information of that player
      socket.to(gameId).emit('newPlayer', player); // modified emit to send to specific gameId, ensuring players are in their proper rooms 
      socket.to(gameId).emit('playerInGameMap', { message:  `Player ${player.name} connected to your '${gameId}' game room!`});
      console.log(`game_ConsoleLog: Player ${player.name} connected to game room: ${gameId}`);

  });

    socket.on('clientPlayerUpdate', (playerData) => {
    const gameId = playerData.gameId;  
      players.set(playerData.id, playerData);
      // console.log(playerData.activeKeys)
      socket.to(gameId).emit('playerUpdates', {'id': playerData.id, 'x': playerData.playerX, 'y': playerData.playerY, 'activeKeys': playerData.activeKeys, 'direction': playerData.direction});
    });

  // Listen for player data from client 
  socket.on('newPlayerConnect', (playerData) => {
      
    const gameId = playerData.gameId;
    // console.log('New player connected:', playerData.name);
    socket.to(gameId).emit('newPlayerConnect', playerData); 
    console.log('New player connected:', playerData.name);
  });

  // Listen for player Shot from the player.js class 
  socket.on('playerShoot', (data) => {
    const { playerId, x, y, direction, gameId } = data;
    // console.log("serverConsoleLog:", playerId, "in game: ",gameId, "just shot, server recorded/created");

    // broadcast an event with playerShoot data to Game.js so adjacent players can trigger a handlePlayerShoot function to recreate the shot arrow 
    socket.to(gameId).emit('playerShooting', { playerId, x, y, direction });
});


//*NEW CONTENT -------------------------------------------------------------------------------------
// Disable dead player by setting player as inactive. 
// Emit player died event to game room players and 
// once player is net as inactive, player's position will not be required clientPlayerUpdate
socket.on('playerDied', (data) => {
  const {gameId, playerId} = data;
    
  // *NEWCONTENT - Set player as inactive after death instead of deleting
  if (players.has(playerId)) {
    const player = players.get(playerId); // Get the player object from the players Map
    player.active = false; // Set the player as inactive
    players.set(playerId, player); // Update the player status in the players Map
  };

  console.log(`Player ${playerId} died - in game room: ${gameId}.`);
  socket.to(gameId).emit('setDeadPlayerStatus', { playerId, active: false});
});  


//***END NEW CONTENT*** ---------------------------------------------------------------------------



  // Listen for game room creation requests
  socket.on('createGameRoom', (gameId) => {
    
    //create a new gameID
    if (!gameStates[gameId]) {
      gameStates[gameId] = { 
        players: new Set(),
        started: false};
      console.log(`New Game room '${gameId}' created`);
    }

    // Check if the game room is at capacity
    if (gameStates[gameId].players.size >= 10) {
      socket.emit('gameAtPlayerCapacity', { message: 'Game room is at capacity, create another room', gameId });
      return; 
    } 
    // Check if the game has already started and prevent new players from joining
    if (gameStates[gameId].started === true) {
      socket.emit('gameAlreadyStarted', { message: 'Game has already started, create another room', gameId });
      return; // TODO QC THIS 
    }
  
    // Add the player to the game state and join the game room
    gameStates[gameId].players.add(socket.id);
    socket.join(gameId);
    console.log(`lobby_ConsoleLog: Player with socketID: ${socket.id} joined game room ${gameId}`);
    
    // Notify the player that they've joined the room
    socket.emit('gameRoomCreated', { gameId: gameId, message: `lobbyScene_To_Player: You've joined game room: ${gameId}` });

    // Notify only players within the same room that a new player has joined
    socket.to(gameId).emit('playerJoinedRoom', { message: `lobbyScene_To_GameRoom: Player with ID ${socket.id} has successfully joined your game '${gameId}'! `});
}); 


//**** NEW CONTENT ****-----------------------------------------------------------------------------

socket.on('playerReady', (data) => {
  const { gameId, playerId } = data;

  if (gameStates[gameId] && players.has(playerId)) {
    let game = gameStates[gameId];
    players.get(playerId).active = true;  // Mark player as active (ready)

    // Check if all players in the game are active
    if (Array.from(game.players).every(id => players.get(id).active)) {
      startGame(gameId); // Start the game after all players are ready
    }
  } // TODO Implement a time that locks the game room after 40 seconds
});

function startGame(gameId) {
  let game = gameStates[gameId];
  game.started = true; // Mark the game as started // TODO Check this to see if it locks the game room
  io.in(gameId).emit('gameStarted', { message: 'Game has started.' });
  console.log(`Game ${gameId} has started.`);
}



  //TODO Create gameover logic that does deletes all but the socket.id. 


// Handle player disconnection
  socket.on('disconnect', () => {
    Object.keys(gameStates).forEach(gameId => {
      if (gameStates[gameId].players.has(socket.id)) {
        gameStates[gameId].players.delete(socket.id);

        // Check if the game can still start
        if (gameStates[gameId].players.size > 0 && Array.from(gameStates[gameId].players).every(id => players.get(id).active)) {
          startGame(gameId);
        } else if (gameStates[gameId].players.size === 0) {
          delete gameStates[gameId];
        }

        console.log(`Player with ID ${socket.id} has left game room ${gameId}`);
      }
    });
    console.log(`Player with ID ${socket.id} disconnected`);
  });
})


  // Start listening on the specified port
  server.listen(PORT, "localhost", () => {
    console.log(`Server is listening on http://localhost:${PORT}`);
  });

  module.exports = app;

