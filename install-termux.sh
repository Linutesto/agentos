#!/bin/bash
set -e

echo "==========================================="
echo "   AgentOS - Termux Installation Script    "
echo "==========================================="

echo "1. Updating Termux packages..."
pkg update -y

echo "2. Installing required dependencies..."
pkg install -y nodejs git curl jq sqlite

echo "3. Installing NPM dependencies..."
npm install

echo "4. Compiling TypeScript..."
npm run build

echo "5. Linking globally..."
npm link

echo "==========================================="
echo " Installation Complete!                    "
echo "==========================================="
echo "Run 'agentos tui' to start the kernel UI"
echo "Run 'agentos --help' for CLI options"
