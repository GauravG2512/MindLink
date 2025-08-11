const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
// We'll configure Socket.IO with CORS settings for production
const io = new Server(server, {
    cors: {
        origin: "https://mindlinktelepathy.netlify.app",
        methods: ["GET", "POST"]
    }
});
const port = process.env.PORT || 3000;

// Game state management
const games = {}; // Stores active game rooms

// Serve the index.html file for the root route.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Serve static files from the 'client' directory for all other routes.
app.use(express.static(path.join(__dirname, '../client')));

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Handle creating a new game room
    socket.on('create_game', (data) => {
        const { playerName } = data;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let gameCode = '';
        for (let i = 0; i < 4; i++) {
            gameCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        if (!games[gameCode]) {
            games[gameCode] = {
                players: [{ id: socket.id, name: playerName }],
                state: 'waiting',
                prompt: null,
                responses: {}
            };
            socket.join(gameCode);
            socket.emit('game_created', { gameCode });
            console.log(`Game created with code: ${gameCode} by ${playerName}`);
        } else {
            socket.emit('create_game_error', { message: 'Game code already exists' });
        }
    });

    // Handle joining an existing game room
    socket.on('join_game', (data) => {
        const { gameCode, playerName } = data;
        const game = games[gameCode];

        if (game && game.players.length === 1) {
            game.players.push({ id: socket.id, name: playerName });
            game.state = 'playing';
            socket.join(gameCode);
            
            const player1Name = game.players[0].name;
            const player2Name = game.players[1].name;
            io.to(gameCode).emit('game_started', { 
                player1: player1Name, 
                player2: player2Name
            });

            startNewRound(gameCode);
            console.log(`Player ${playerName} joined game ${gameCode}`);
        } else {
            socket.emit('join_game_error', { message: 'Invalid game code or game is full' });
        }
    });

    // Handle player submission
    socket.on('submit_word', (data) => {
        const { gameCode, word } = data;
        const game = games[gameCode];

        if (game && game.responses[socket.id] === undefined) {
            game.responses[socket.id] = word;
            
            if (Object.keys(game.responses).length === 2) {
                endRound(gameCode);
            }
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const code in games) {
            games[code].players = games[code].players.filter(player => player.id !== socket.id);
            if (games[code].players.length === 0) {
                delete games[code];
                console.log(`Game room ${code} deleted.`);
            } else {
                io.to(code).emit('player_disconnected');
            }
        }
    });
});

async function startNewRound(gameCode) {
    const game = games[gameCode];
    if (game) {
        game.responses = {};

        // ====> Using Lorem Picsum for a random image <====
        const imageUrl = `https://picsum.photos/400/300?random=${Math.random()}`;
        game.prompt = imageUrl;
        io.to(gameCode).emit('new_round', { prompt: imageUrl });
        
        setTimeout(() => {
            if (game.state === 'playing') {
                endRound(gameCode);
            }
        }, 30000);
    }
}

function endRound(gameCode) {
    const game = games[gameCode];
    if (game && game.state === 'playing') {
        const [player1Id, player2Id] = game.players.map(p => p.id);
        const [player1Word, player2Word] = [game.responses[player1Id], game.responses[player2Id]];

        let match = false;
        if (player1Word && player2Word && player1Word.toLowerCase() === player2Word.toLowerCase()) {
            match = true;
        }

        io.to(gameCode).emit('round_over', {
            match,
            player1Word: player1Word || 'No response',
            player2Word: player2Word || 'No response'
        });

        setTimeout(() => startNewRound(gameCode), 3000);
    }
}

server.listen(port, () => {
    console.log(`MindLink server running on http://localhost:${port}`);
});