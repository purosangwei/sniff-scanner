'use strict';
// Well-known npm and PyPI names. Used two ways:
// 1. a dependency one letter away from one of these is a likely typosquat
// 2. these are skipped for the slower "how old is this package" registry check
const NPM = `react react-dom next vue nuxt svelte angular @angular/core express koa fastify hapi nestjs @nestjs/core
axios node-fetch got request superagent ky cross-fetch
lodash underscore ramda moment dayjs date-fns luxon uuid nanoid
typescript ts-node tsx esbuild vite webpack rollup parcel babel-loader @babel/core @babel/preset-env
eslint prettier jest mocha chai vitest sinon supertest cypress playwright puppeteer
dotenv cors body-parser cookie-parser helmet morgan multer jsonwebtoken bcrypt bcryptjs passport
mongoose mongodb pg mysql mysql2 sequelize prisma @prisma/client knex redis ioredis sqlite3 typeorm
socket.io socket.io-client ws graphql apollo-server @apollo/client
chalk commander yargs inquirer enquirer prompts preact ora debug winston pino nodemon concurrently cross-env rimraf
tailwindcss postcss autoprefixer sass styled-components @emotion/react classnames clsx
redux @reduxjs/toolkit react-redux zustand jotai recoil mobx react-router react-router-dom swr @tanstack/react-query
ethers web3 viem wagmi @wagmi/core @rainbow-me/rainbowkit @solana/web3.js @solana/spl-token bs58 bn.js
@openzeppelin/contracts hardhat @nomicfoundation/hardhat-toolbox truffle ganache @coral-xyz/anchor @metamask/sdk
web3modal @web3modal/wagmi @walletconnect/web3-provider
husky lint-staged patch-package nodemailer sharp jimp canvas pdfkit xlsx csv-parser
zod yup joi ajv validator class-validator immer rxjs
crypto-js js-sha3 tweetnacl elliptic secp256k1 keccak buffer process events util path-browserify
next-auth firebase firebase-admin @supabase/supabase-js stripe openai @anthropic-ai/sdk
react-icons @mui/material @chakra-ui/react antd framer-motion three chart.js recharts d3
express-session connect-mongo cheerio jsdom marked highlight.js
mongodb-memory-server bull bullmq node-cron cron`.split(/\s+/).filter(Boolean);

const PYPI = `requests flask django fastapi uvicorn numpy pandas scipy matplotlib seaborn scikit-learn
tensorflow torch keras pillow beautifulsoup4 lxml selenium pytest sqlalchemy psycopg2 psycopg2-binary
pymongo redis celery boto3 botocore pydantic python-dotenv web3 eth-account eth-utils solana solders
aiohttp httpx websockets cryptography pycryptodome pyyaml jinja2 click colorama tqdm rich openai anthropic`
  .split(/\s+/).filter(Boolean);

module.exports = { NPM: new Set(NPM), PYPI: new Set(PYPI), NPM_LIST: NPM, PYPI_LIST: PYPI };
