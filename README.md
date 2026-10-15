# Опора

Интеллектуальный сервис для анализа профиля бизнеса, подбора релевантных мер поддержки и сопровождения предпринимателя от поиска возможности до подготовки документов.

«Опора» — самостоятельное веб-приложение: интерфейс на React/Vite и REST API на Node.js/Express. Пользователь добавляет компанию по ИНН или проект без юрлица, изучает официальные программы, сохраняет варианты и готовит тексты документов. Неизвестные условия остаются явно неподтверждёнными. Заявка автоматически не отправляется: подготовка заканчивается переходом на официальный сайт оператора программы.

## Основные функции

- загрузка компании по ИНН (DaData или импортированный индекс ФНС);
- профиль компании, а также проекта без юридического лица;
- подбор мер поддержки по профилю и потребности (цель, сумма, срок, собственные средства, залог);
- проверка формальных критериев детерминированными правилами, без участия LLM;
- GigaChat: объяснение условий, диалог с контекстом бизнеса, анализ и персонализация экранов;
- подготовка документов: описание проекта, список документов, редактируемый черновик, экспорт TXT;
- проверка документов: чтение TXT/PDF/DOCX и сканов (OCR на устройстве), AI-проверка комплекта;
- официальный каталог: встроенный снимок, «Электронный бюджет» Минфина и подключённые операторы поддержки;
- персональные рекомендации и стратегия финансирования;
- уведомления о новых релевантных мерах внутри приложения;
- календарь опубликованных сроков с экспортом ICS.

## Архитектура

```text
Browser
  ↓
React / TypeScript / Vite            miniapp/src
  ↓ REST API (/api)
Node.js / Express                    miniapp/api-server
  ├─ company-data      профиль компании по ИНН
  ├─ funding-catalog   каталог, подбор, стратегия, уведомления
  ├─ ai                GigaChat, контекст, эмбеддинги, источники
  └─ documents         шаблоны и проверка документов
  ↓
ФНС / официальные источники / SQLite / JSON
```

| Часть | Точка входа / роль |
|---|---|
| Web App | `miniapp/index.html` → `src/main.tsx` → `App.tsx` → `business/BusinessApp.tsx` |
| Элементы управления | `src/business/UiControls.tsx`, базовые стили `styles/ui-kit.css`, тема `styles/ui-controls.css` |
| API | `miniapp/api-server/server.ts` → `business-server.ts`; маршруты в `app.ts` |
| Сессия | `miniapp/api-server/session.ts` (сервер), `src/business/session.ts` (браузер) |
| Уведомления | `funding-catalog/notifications.ts` — подписки, подбор, AI-проверка, хранение; `funding-catalog/notification-delivery.ts` — интерфейс внешней доставки |
| Docker frontend | `miniapp/Dockerfile` → nginx, конфигурация `docker/nginx.conf` |
| Production frontend вне Docker | `miniapp/scripts/serve.cjs`, `ecosystem.config.cjs` |
| Данные | ФНС — read-only SQLite; каталог, аккаунты и подписки — persistent volume (SQLite/JSON); черновики — localStorage |

Правила проверяют формальные условия участия; GigaChat получает профиль, задачу и выбранную меру, помогает искать и объяснять поддержку, готовить и проверять тексты. Модель не меняет рассчитанные статусы соответствия.

### Сессия и авторизация

Внешней авторизации в MVP нет. Браузер создаёт анонимную сессию (32 случайных байта, `localStorage`) и передаёт её в заголовке `X-Opora-Session`; сервер хранит только SHA-256. Сессия нужна, чтобы хранить на сервере компанию и подписку на уведомления этого браузера. Она не подтверждает личность и полномочия действовать от имени компании.

Каталог, подбор, AI и документы доступны без сессии. `/api/account` и `/api/notifications` требуют сессию (иначе 401 `SESSION_REQUIRED`). Внешнюю авторизацию (банковскую, ЕСИА) можно подключить, передав свой `IdentityResolver` в `createApp({ identity })`: маршруты при этом не меняются. Подробнее — [docs/account-and-verification.md](docs/account-and-verification.md).

### Уведомления

Фоновый обработчик сопоставляет новые меры с подписками, проверяет релевантность через GigaChat с цитатами из источника и сохраняет уведомления в SQLite. Пользователь включает уведомления и видит их список в «Мой бизнес → Настройки»; «Открыть меру» открывает карточку и отмечает уведомление прочитанным. Внешний канал доставки не подключён; для него предусмотрен интерфейс `NotificationTransport` и outbox с повторами (`notification-delivery.ts`). Подробнее — [docs/live-funding.md](docs/live-funding.md).

## Структура проекта

```text
.
├─ miniapp/                  веб-приложение
│  ├─ src/                   React-интерфейс (business/ — экраны, стили, клиентская логика)
│  ├─ api-server/            Express API
│  │  ├─ company-data/       ФНС, DaData, импорт XML, индекс SQLite
│  │  ├─ funding-catalog/    официальный каталог, matching, стратегия, уведомления
│  │  ├─ ai/                 GigaChat, контекст, источники, сценарии
│  │  ├─ tests/fixtures/     synthetic данные только для тестов
│  │  └─ *.ts                app, session, account, documents, privacy, gigachat
│  ├─ scripts/               production-сервер, проверки UX и production
│  └─ public/                OCR-ресурсы (готовятся postinstall)
├─ docker/nginx.conf         nginx для Docker frontend
├─ docker-compose.yml        api + miniapp
├─ ops/                      скрипт деплоя на сервер с откатом
├─ docs/                     описание подсистем и проверок
├─ qa/                       отчёты и результаты прошлых проверок
├─ openapi.yaml              OpenAPI 3.0.3 контракт API
├─ DATA-API.yaml             публичные повторяемые проверки API
└─ .env.example              шаблон переменных окружения
```

## Локальный запуск

Нужны Node.js **22.13+** (встроенный `node:sqlite`, в Node 22 возможен ExperimentalWarning) и npm.

```bash
npm ci --prefix miniapp
npm ci --prefix miniapp/api-server
cp .env.example .env        # только если .env ещё нет
npm run api:dev             # отдельный терминал, API на порту 3002
npm run dev                 # отдельный терминал, интерфейс на порту 3000
```

Откройте http://localhost:3000. Vite проксирует только `/api/` на `http://localhost:3002` (`miniapp/vite.config.ts`); модули `/api-server/` не уходят в proxy. Если порт занят, используйте свободный (`PORT=3012 npm run api:dev`), но тогда поменяйте proxy.

Без ключей сервисы запускаются: каталог и подбор работают, поиск компании требует DaData либо наполненного индекса ФНС, GigaChat без ключа не считается подключённым.

```bash
curl http://localhost:3002/api/health
curl http://localhost:3002/api/providers/status
curl http://localhost:3002/api/funding/status
curl http://localhost:3002/api/ai/status
curl -H 'Content-Type: application/json' -d '{"profile":{},"need":{"purpose":"покупка оборудования","amount":10000000,"preferredTermMonths":60}}' http://localhost:3002/api/funding/match
```

### Docker

Нужны Docker Engine/Desktop и Docker Compose v2. Из корня репозитория:

```bash
cp .env.example .env        # если .env ещё нет; существующий не перезаписывайте
mkdir -p fns-data
docker compose up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:3002 (опубликован только на `127.0.0.1`)

```bash
docker compose config --quiet
docker compose ps
curl --fail http://localhost:3000/api/health
curl --fail http://localhost:3002/api/health
docker compose down
```

Nginx обслуживает Vite build и проксирует `/api/` на `api:3002`. Том `opora-sources` хранит архив источников, live-каталог, аккаунты и подписки; `docker compose down` его сохраняет, `down -v` — удаляет. FNS volume монтируется read-only: импорт выполняется на хосте. Для дополнительного CA добавьте compose override с read-only PEM и `NODE_EXTRA_CA_CERTS=/certs/trusted.pem` для API.

## Переменные окружения

Шаблон — [.env.example](.env.example). Не храните секреты в git.

| Переменная | Где используется / значение |
|---|---|
| `APP_ORIGIN` | CORS API; по умолчанию `http://localhost:3000`, несколько значений через запятую |
| `DADATA_API_KEY` | API: поиск компании через DaData; без ключа используется локальный индекс ФНС |
| `FNS_DATA_DIR` | Каталог индекса ФНС; по умолчанию `fns-data` в корне. Compose монтирует его в `/data/fns` read-only |
| `GIGACHAT_AUTH_KEY` | Ключ GigaChat только для API; во frontend не передаётся |
| `GIGACHAT_SCOPE`, `GIGACHAT_MODEL` | По умолчанию `GIGACHAT_API_PERS`, `GigaChat-2-Pro` |
| `AI_SOURCE_SYNC`, `FUNDING_SYNC` | Фоновый мониторинг источников и обновление каталога/уведомлений; `off` отключает цикл |
| `OPORA_SOURCE_DIR`, `OPORA_FUNDING_DIR` | Каталоги данных; в Compose — `/data/sources`, `/data/sources/funding` |
| `OPORA_MONITOR_TOKEN` | Необязательный Bearer-токен для `/api/internal/funding/status` |
| `PORT` | Порт API на хосте (по умолчанию 3002) или production frontend (`serve.cjs`, по умолчанию 3000) |
| `NODE_EXTRA_CA_CERTS` | Доверенный PEM для GigaChat; задаётся до запуска Node, не через dotenv |

## Тесты

```bash
npm test                                   # интерфейсная логика и API
npm run test:production --prefix miniapp   # production-сервер и перезапуск API
node --test ops/deploy.test.cjs            # транзакция деплоя и откат
```

Browser UX-проверка (Chromium и WebKit, две темы, четыре ширины) использует контролируемые ответы API и ничего не отправляет:

```bash
npx --prefix miniapp playwright install chromium webkit
npm run build --prefix miniapp
PORT=3021 npm start --prefix miniapp       # отдельный терминал
OPORA_UI_URL=http://127.0.0.1:3021 npm run test:ux --prefix miniapp
```

## Production build

```bash
npm run build                              # API (tsc → miniapp/api-server/dist) и frontend (miniapp/dist)
npm --prefix miniapp/api-server run start:prod   # dist/server.js, порт 3002
npm start --prefix miniapp                 # отдельный терминал: miniapp/dist с gzip и кешированием, /api/ → 127.0.0.1:3002
npm run check:production --prefix miniapp  # проверка фактической выдачи
```

Frontend по умолчанию слушает `127.0.0.1:3000` (`PORT`, `HOST`). HTTPS завершает внешний reverse proxy. Сборка сохраняет старые файлы с хешами для уже открытых вкладок; файлы без хеша кешируются на час.

Деплой на сервер — `ops/deploy.cjs` (запускается на хосте под `flock`): сборка и тесты во временном каталоге, переключение артефактов, перезапуск `opora-frontend` (`ecosystem.config.cjs`) и `opora-api` (`miniapp/scripts/restart-api.cjs`) через PM2, проверка health и откат при ошибке. Подробнее — [docs/deployment.md](docs/deployment.md).

## API

- [openapi.yaml](openapi.yaml) — OpenAPI 3.0.3 контракт API: JSON-ошибки `{error, code}`, nullable поля, iCalendar.
- [DATA-API.yaml](DATA-API.yaml) — 6 публичных повторяемых проверок API (`https://business-opora.ru`). Проверка `/api/ai/status` не расходует токены и не утверждает готовность AI.
- API доступен через `/api/`. Тест `contracts.test.ts` сверяет DATA-API с OpenAPI и реальными ответами.

## Ограничения MVP

- Юридически значимая заявка не отправляется: пользователь готовит тексты и переходит на сайт оператора.
- Внешней авторизации нет; сессия браузера не подтверждает личность и полномочия. ЕСИА не подключена.
- Неизвестные условия не выдаются за подтверждённые; закрытые отборы не считаются доступными сейчас.
- Базовый персональный список использует тип заявителя и основной ОКВЭД. Остальные условия уточняют оценку; наличие карточки не гарантирует право на участие.
- Точный перечень документов может быть неизвестен. Отмеченная готовность и AI-проверка не доказывают подлинность документов.
- Уведомления показываются только внутри приложения; внешняя доставка не подключена.
- Официальный snapshot — реальные зафиксированные сведения, но не доказательство актуальности каждого условия. Synthetic/mock данные используются только в тестах. Локальный шаблон документа и fallback AI обозначаются отдельно от ответа модели.
- Нет платежей, банковских API, автоматической подачи и гарантии одобрения.

---

<details>
<summary>Подробные инструкции по данным, источникам и настройке</summary>

## Сценарий

1. Добавить бизнес по ИНН либо выбрать «У меня пока нет компании».
2. Для компании получить сведения через DaData (при настроенном серверном ключе) либо из импортированного индекса ФНС. Неизвестные поля можно дополнить вручную. Без подключённого источника API вернёт 503, без найденной записи — 404. Подстановки вымышленных компаний нет.
3. Указать цель, при желании сумму, срок, собственные средства и потребность в залоге.
4. Нажать «Найти варианты». Открыть карточку, проверить совпавшие, неизвестные и невыполненные условия и официальный источник.
5. Сохранить возможность или начать подготовку: описание проекта, список документов, чтение TXT/PDF/DOCX/сканов, AI-проверка и редактируемый черновик.
6. Отметить комплект после самостоятельной сверки с оператором. Итог: «Комплект готов к проверке перед подачей». Реальной отправки нет.
7. Открыть календарь опубликованных сроков, включить уведомления о новых мерах или запросить объяснение AI.

Для проверки без выгрузки и секретов создайте проект без юрлица. Ссылка `?program=<id>` открывает карточку меры. Автоматический каталог Минфина, AI-проверка новых мер и уведомления: [настройка и ограничения](docs/live-funding.md), [несколько источников](docs/multi-source-funding.md).

## Подробности архитектуры

```text
Browser → React/Vite → Express API
                       ├─ CompanyDataService → FNSRegistrySnapshotProvider → SQLite
                       │                        + МСП / численность / доходы-расходы
                       ├─ OfficialSnapshotProvider → FundingCatalogService
                       │                            → deterministic matching → strategy
                       ├─ NotificationWorker → AI-проверка → SQLite (в приложении)
                       └─ privacy boundary → OAuth/token cache → GigaChat
```

Код: `miniapp/api-server/company-data`, `miniapp/api-server/funding-catalog`, `miniapp/src/business`. Модель профиля и черновиков находится в `business-model.ts`, подготовка текстов — в `documents.ts`. Synthetic XML, компании и программы находятся в `miniapp/api-server/tests/fixtures` и не являются production-провайдерами.

`FundingNeed`: по умолчанию «Все цели», без ограничения каталога по назначению; это не подтверждает соответствие конкретной цели. Сумма — внешняя потребность; собственные средства указываются отдельно. `ProjectProfile` содержит регион, отрасль, стадию, команду и потребность, не требует ИНН. `applicantTypes` проверяется как обязательное ограничение.

Matching проверяет известные ограничения, цель, диапазоны суммы/срока и статус приёма. Неизвестный факт не проходит проверку. Закрытые и будущие отборы не попадают в «Подходит сейчас». Неполное покрытие суммы — `partial`, документы учитываются отдельно. Score — техническое соответствие, не вероятность одобрения. Поручительство повышает приоритет при нехватке залога, но не считается выдачей денег. Лимиты вариантов в стратегии не суммируются.

Новый `FundingProvider` реализует `getCatalog()` и передаётся в `FundingCatalogService`; matching не меняется. Новый официальный домен добавляется в allowlist после проверки принадлежности оператору.

## Встроенный снимок и сопровождение источников

Ниже — исторический состав встроенного снимка от **22.09.2026**, а не состояние текущего live-каталога. Сам снимок обновляется вручную; отдельно работают импорт «Электронного бюджета» и монитор официальных источников. Параметры с неполным подтверждением оставлены `null`, дополнительные ограничения показаны явно.

| Инструмент | Состояние в снимке | Первоисточник |
|---|---|---|
| ФРП — Проекты развития | active | [ФРП](https://www.frprf.ru/zaymy/proekty-razvitiya/) |
| ФРП — Комплектующие изделия | active | [ФРП](https://frprf.ru/zaymy/komplektuyushchie/) |
| Зонтичное поручительство | active | [Корпорация МСП](https://www.corpmsp.ru/to-business/obespechenie-kreditov-zaymov/zontichnye-poruchitelstva/) |
| ФСИ — Старт-1 | closed | [Фонд содействия инновациям](https://fasie.ru/programs/programma-start/) |
| Агростартап — Татарстан, отбор 2024 | closed, 28.08.2024 | [Минсельхозпрод Татарстана](https://agro.tatarstan.ru/index.htm/news/2337342.htm) |
| РЭЦ — Справка по условиям доступа на внешние рынки | unknown | [Официальный типовой договор](https://myexport.exportcenter.ru/upload/documents/expert-platform/Типовой_договор_Аналитика_Справка_по_условиям_доступа_на_внешние_рынки.pdf) |

Договор РЭЦ подтверждает состав услуги; возможность заказа и стоимость сейчас не подтверждены. Исторический отбор АПК нельзя использовать как действующий. ФРП «Производительность труда» и «Автокомпоненты» исследованы, но не добавлены в этот снимок без полного переноса дополнительных условий; см. [docs/official-sources.md](docs/official-sources.md).

Обновление: сверить первоисточник и нормативные условия, изменить `official-funding.snapshot.json`, даты `verifiedAt` и версии, выполнить тесты. Обязательны официальный HTTPS URL, дата проверки и честный статус приёма. Валидатор отклоняет synthetic/неизвестный домен и запись без источника.

## ФНС и локальный индекс

Для поиска без выгрузки полного реестра задайте `DADATA_API_KEY` на API-сервере. Используется документированный [findById/party](https://dadata.ru/api/find-party/) с поиском головной организации по точному ИНН. При наличии ключа выбирается DaData; без него — провайдер локального индекса ФНС. Ошибки доступа и лимита не заменяются ответом «компания не найдена». Ответы кэшируются в памяти на 15 минут, параллельные одинаковые запросы объединяются. На сервере ключ хранится в `/opt/app/.env.dadata` с правами `600` и загружается только API.

Данные DaData помечаются `mode: aggregator` с источником каждого поля. Численность, налоги, финансовые показатели и МСП доступны в зависимости от ответа и тарифа; отсутствие поля остаётся неизвестным. Доходы не подменяют выручку. Поиск по ИНН не подтверждает полномочия пользователя.

Для локального индекса ФНС поддержаны официальные XML:

- [ЕГРЮЛ/ЕГРИП для интеграции](https://www.nalog.gov.ru/rn77/service/egrip2/), выбранные поля форматов ЕГРЮЛ 4.07/4.08 и ЕГРИП 4.06/4.07 ([приказ ФНС № ЕД-7-14/613@](https://www.nalog.gov.ru/rn77/about_fts/docs/16493030/)). Доступ к полным выгрузкам требует официальных атрибутов доступа; приложение их не подменяет неофициальным API.
- [Реестр МСП — документация](https://rmsp.nalog.ru/developers.html), XML 4.06. Отсутствие записи в частичной выгрузке не доказывает отсутствие статуса МСП.
- [Среднесписочная численность](https://www.nalog.gov.ru/opendata/7707329152-sshr2019/), `СведССЧР/@КолРаб`.
- [Доходы и расходы](https://www.nalog.gov.ru/opendata/7707329152-revexp/), `СумДоход`, `СумРасход`.

**Доходы не приравниваются к выручке:** `income` и `expenses` сохраняются отдельно, `revenue=null`. `ДатаСост` — дата состояния данных, не отчётный год; период передаётся через `--period` после проверки паспорта набора.

Каждый заполненный факт содержит provenance: источник, URL, дату, при наличии — период. ФИО ИП, директоров, учредителей и полный адрес не сохраняются.

```bash
npm run sync:fns -- --dataset registry --file /absolute/path/EGRUL.xml \
  --source-url https://www.nalog.gov.ru/rn77/service/egrip2/ \
  --updated-at YYYY-MM-DD

npm run sync:fns -- --dataset sme --file /absolute/path/SME.zip \
  --source-url https://rmsp.nalog.ru/developers.html \
  --updated-at YYYY-MM-DD

npm run sync:fns -- --dataset employees --file /absolute/path/employees.zip \
  --source-url https://www.nalog.gov.ru/opendata/7707329152-sshr2019/ \
  --updated-at YYYY-MM-DD --period 2025

npm run sync:fns -- --dataset financials --file /absolute/path/revexp.zip \
  --source-url https://www.nalog.gov.ru/opendata/7707329152-revexp/ \
  --updated-at YYYY-MM-DD --period 2025
```

`--file` можно заменить на `--url` с официальным HTTPS-адресом файла ФНС. Укажите `--dir` абсолютным путём (npm запускает CLI из `miniapp/api-server`); по умолчанию — `fns-data` в корне репозитория. Импорт делает upsert; `--replace` очищает только выбранный dataset в одной транзакции — используйте лишь для полной выгрузки. Не запускайте импорты параллельно.

XML/ZIP читаются потоком, UTF-8 и Windows-1251; DTD/XXE запрещены. Ограничения: download 2 ГБ, один XML 4 ГБ, суммарное расширение ZIP 20 ГБ. Ошибка откатывает импорт; сохраняются SHA-256, URL, даты и статистика. Данные и SQLite не входят в git. На чистом запуске индекс отсутствует: `GET /api/providers/status` показывает `missing` — это корректное состояние.

## GigaChat

OAuth, кеш токена, объединение параллельных обновлений, один повтор после 401, таймауты и обработка ошибок. `GET /api/ai/status` отличает настройку от подтверждённого успешного запроса: до первой успешной генерации `configured=true, checked=false, status=unavailable, reason=not_verified`; без ключа — `not_configured`. `/api/ai/assist` использует контекст, историю, вызовы функций и поиск по эмбеддингам; известные реквизиты скрываются. Тексты документов передаются после отдельного запуска пользователем. Старый `/api/assistant` сохраняет политику strict-v1. Подробнее — [docs/ai-platform.md](docs/ai-platform.md).

Если Node TLS возвращает `SELF_SIGNED_CERT_IN_CHAIN` или `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, настройте доверенную цепочку по [официальной инструкции GigaChat](https://developers.sber.ru/docs/ru/gigachat/certificates); не отключайте TLS. Например, `NODE_EXTRA_CA_CERTS=/absolute/path/trusted.pem npm run api:dev`.

## Данные, безопасность и ограничения

- Профиль, проект, потребность, закладки и черновики: versioned localStorage v2 с миграцией. Компания сессии и подписка на уведомления могут храниться на API.
- Локальная проверка текста ищет упоминания разделов. AI-проверка анализирует показанный текст и его согласованность с проектом. Обе не подтверждают юридическую силу и подлинность. Файл читается на устройстве, в AI передаётся текст после отдельного нажатия.
- Календарь содержит только опубликованные даты. Монитор официальных сайтов работает каждые шесть часов. Новые материалы расширяют поисковую базу, формальный каталог требует проверки.
- `.env`, PEM/ключи и datasets игнорируются. Backend-only secrets, body limit 48 КБ (384 КБ для `/api/ai/assist`), CORS allowlist, rate limit 15 AI / 120 остальных запросов в минуту на IP, до четырёх одновременных AI-запросов, `no-store`. За reverse proxy правильно настройте сетевой периметр.
- Каталог доступен для чтения; изменение аккаунта и подписки требует сессии; локальные статусы заявок — только draft/collecting_documents/ready_for_review.

</details>
