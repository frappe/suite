#!/bin/bash

# Frappe Meet SFU Server Setup and Start Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Frappe Meet SFU Server Setup${NC}"
echo "================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js first.${NC}"
    exit 1
fi

# Check Node.js version (mediasoup requires Node.js 22+)
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="22.0.0"

# Simple version comparison (major version check)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
REQUIRED_MAJOR=22

if [ "$NODE_MAJOR" -lt "$REQUIRED_MAJOR" ]; then
    echo -e "${RED}❌ Node.js version ${NODE_VERSION} is not supported. Please install Node.js 22 or higher.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js version: ${NODE_VERSION}${NC}"

# Check if yarn is installed
if ! command -v yarn &> /dev/null; then
    echo -e "${RED}❌ Yarn is not installed. Please install Yarn first.${NC}"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    yarn install
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${GREEN}✅ Dependencies already installed${NC}"
fi

# Build TypeScript
echo -e "${BLUE}🔨 Building TypeScript...${NC}"
yarn build
echo -e "${GREEN}✅ TypeScript built successfully${NC}"

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 Creating .env file...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✅ .env file created from .env.example${NC}"
    echo -e "${YELLOW}⚠️  Please edit .env file with your configuration${NC}"
else
    echo -e "${GREEN}✅ .env file exists${NC}"
fi

# Check if port is available
PORT=${PORT:-3000}
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${RED}❌ Port $PORT is already in use. Please change the PORT in .env file.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Port $PORT is available${NC}"

# Start the server
echo -e "${BLUE}🎬 Starting SFU Server...${NC}"
echo "================================"

if [ "$NODE_ENV" = "development" ]; then
    echo -e "${BLUE}🚀 Starting server in development mode with hot reload...${NC}"
    echo -e "${YELLOW}📁 Watching: src/**/*.{ts,js,json}${NC}"
    echo -e "${YELLOW}🔄 Hot reload enabled - server will restart on file changes${NC}"
    yarn dev:watch
else
    # Production mode
    node dist/sfu-server/src/server.js
fi
