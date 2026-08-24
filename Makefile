## Makefile básico para facilitar execução local
.PHONY: install env migrate dev workers setup

install:
	npm install

env:
	@if [ -f .env.local ]; then echo ".env.local exists"; else cp .env.example .env.local && echo ".env.local created; edit it"; fi

migrate:
	npm run db:migrate

dev:
	npm run dev

workers:
	npm run dev:workers

setup: install env migrate
