require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors()); app.use(express.json());
const todos = [];
app.get('/todos', (req, res) => res.json(todos));
app.post('/todos', (req, res) => { todos.push({ id: todos.length + 1, ...req.body }); res.status(201).json(todos.at(-1)); });
app.listen(process.env.PORT || 3000, () => console.log('listening'));
