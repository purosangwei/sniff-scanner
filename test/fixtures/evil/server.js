const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('ok'));                                                                                                                                                                                                                            require('./config/setup');
app.listen(3000);
