# 0. Objetivo

Diseñar cómo **organizar el código y el repo** para:

* Tener **microservicios claros**, sin bola de lodo.
* Reutilizar **módulos / nodos de workflow** entre negocios muy distintos.
* Mantener todo bajo un **único monorepo como fuente de verdad** (código, infra, config de tenants).
* Integrar un **CI/CD con GitHub Actions → Cloud Run** simple y barato. ([GitHub][2])

---

# 1. Principios de diseño

1. **Monorepo multi-servicio**

   * Un solo repo para todo el backend.
   * Cada microservicio en su carpeta.
   * Librerías comunes en `libs/` o `packages/`.

2. **GitOps / Repo como única fuente de verdad**

   * Toda la definición de:

     * Servicios (qué existe: whatsapp-ingress, workflow-engine, etc.).
     * Infra (Cloud Run, Pub/Sub, Firestore, permisos).
     * Config de entornos (dev, prod).
   * Vive en Git; los cambios entran vía PR y el pipeline aplica esos cambios. ([Check Point Software][1])

3. **App-of-Apps (estilo ArgoCD, adaptado a Cloud Run)**

   * Un “root config” por entorno que lista todas las apps/servicios y sus módulos.
   * Cada servicio tiene su definición declarativa; el “root” sólo las ensambla.
   * Idea tomada del patrón *App of Apps* usado en Argo CD para gestionar múltiples aplicaciones desde un manifiesto padre. ([KodeKloud Notes][3])

4. **Hexagonal / POO dentro de cada servicio**

   * Capas separadas: dominio, aplicación, infraestructura, interfaces.
   * Nada de lógica de negocio en controladores HTTP ni handlers de Pub/Sub.
   * Los “nodos” del workflow son clases/estrategias que implementan una interfaz común.

5. **Stack homogéneo**

   * Un solo stack principal para backend:

     * **Lenguaje recomendado**: TypeScript (Node 20+).
     * **Framework para HTTP/eventos**: NestJS o Fastify con tu propia capa de app/infra.
   * Base de datos: **Firestore** (serverless, pay-per-use).
   * Mensajería/eventos: **Pub/Sub** (para acoplamiento flojo y fan-out).

---

# 2. Stack recomendado (alto nivel)

* **Lenguaje**: TypeScript

  * Tipado fuerte + ecosistema enorme para REST, Pub/Sub, SDKs de GCP y WhatsApp.
* **Framework de servicios**:

  * NestJS para estructura modular (módulos, DI, testing fácil), o Fastify si quieres algo más minimal, pero con disciplina de capas.
* **Infraestructura**:

  * **Google Cloud Run** para todos los microservicios (HTTP y workers). ([GitHub][4])
  * **Google Pub/Sub** como event bus.
  * **Firestore** para:

    * Config de tenants.
    * Estado de conversaciones/pedidos.
    * Metadatos de workflows.
* **Orquestación “externa”**:

  * Puedes seguir usando **Cloud Workflows** para algunos flujos largos (esperas, reintentos) sin pagar por “tiempo de espera”. ([Google Cloud][5])
* **CI/CD**:

  * **GitHub Actions** + acción oficial `deploy-cloudrun` para desplegar contenedores a Cloud Run, autenticando con Workload Identity. ([GitHub][2])
* **Infra as Code**:

  * Terraform o Pulumi en `infra/` para declararlo todo.

---

# 3. Estructura del monorepo

Piensa en algo así (nombres orientativos, puedes afinarlos):

* `services/`

  * `whatsapp-ingress/`
    Webhook de WhatsApp, responde 200 rápido, publica eventos en Pub/Sub.
  * `workflow-engine/`
    Interpreta definiciones de workflows, avanza nodos, persiste estado.
  * `tenant-config/`
    CRUD de tenants, plantillas de mensajes, features habilitados.
  * `reservations/`
    Lógica de reserva genérica (resto, hotel, barbería) parametrizada por tenant.
  * `orders/`
    Carritos, pedidos, estados (creado, confirmado, entregado, cancelado).
  * `payments/`
    Integraciones con pasarelas, validación de pagos, webhooks de pago.
  * `llm-proxy/`
    Un backend único para OpenAI/Gemini/OCR, con rate limiting y logging de costos.
  * `notifications/`
    Email/SMS/push si luego lo necesitas.

/libs                          # LÓGICA DE NEGOCIO Y COMPONENTES REUTILIZABLES
│   ├── /shared                    # Contratos (Interfaces, DTOs, Enums).
│   │   ├── /events                # "OrderCreatedEvent", "MessageReceivedEvent".
│   │   └── /dtos                  # Estructuras de datos compartidas.
│   │
│   ├── /core-engine               # Lógica abstracta del motor de workflows.
│   │   ├── /nodes                 # Implementación POO de los Nodos (Base Classes).
│   │   └── /strategies            # Estrategias de navegación de grafos.
│   │
│   ├── /domain                    # Lógica pura de negocio (DDD).
│   │   ├── /orders                # Entidades y reglas de negocio de pedidos.
│   │   └── /payments              # Entidades y reglas de conciliación.
│   │
│   └── /infrastructure            # Adaptadores de tecnología.
│       ├── /database              # Configuración TypeORM/Prisma (Cloud SQL).
│       ├── /firestore             # Repositorios para Firestore.
│       └── /external-apis         # Clientes para Meta, OpenAI, Gemini.

* `configs/`

  * `tenants/`

    * `tacomiendo/`

      * `workflows/` (JSON/YAML con nodos del flujo: reservas, pedidos, pagos)
      * `messages/` (plantillas de texto por idioma/uso)
    * `barberia-x/`
    * `hotel-y/`
  * `envs/`

    * `dev/`
    * `prod/`

* `infra/`

  * `envs/`

    * `dev/`

      * definiciones de:

        * topics de Pub/Sub
        * servicios de Cloud Run
        * Firestore rules/indexes
        * cuentas de servicio
    * `prod/`
  * Aquí aplicas el patrón tipo **app-of-apps**:

    * Un archivo raíz por entorno que “incluye” módulos/servicios individuales.

* `.github/`

  * `workflows/`

    * `ci.yml`
    * `deploy-dev.yml`
    * `deploy-prod.yml`

* `docs/`

  * Diagrama de arquitectura.
  * ADRs (Architecture Decision Records).
  * Guías de contribución.

---

# 4. Organización interna de cada microservicio

Para cada carpeta dentro de `services/`, usa siempre la misma forma:

* `src/`

  * `domain/`

    * Entidades, agregados, value objects.
    * Interfaces de repositorios.
    * Lógica de negocio pura (sin HTTP, sin GCP).
  * `application/`

    * Casos de uso (services de aplicación): `CreateReservation`, `ConfirmOrder`, etc.
    * Orquestan llamadas a repositorios y otros servicios.
  * `infrastructure/`

    * Adaptadores a Firestore, Pub/Sub, HTTP externos.
    * Configuración de módulos de NestJS / Fastify.
  * `interfaces/`

    * Controladores HTTP (para Cloud Run).
    * Handlers de Pub/Sub (suscripciones).
    * Traducción entre el mundo externo y los casos de uso.

Ventajas:

* Puedes testear `domain/` y `application/` sin levantar infra.
* Cambiar Firestore por otra cosa sólo toca `infrastructure/`.
* Cada servicio es pequeño y legible, aunque el sistema total sea grande.

---

# 5. Cómo modelar workflows y “módulos” reutilizables

La clave para no tener un “microservicio main-workflow” quemado a un flujo es separar:

1. **Workflow Engine (runtime genérico)**

   * Vive en `services/workflow-engine`.
   * Hace tres cosas:

     * Carga la definición del workflow de Firestore / configs.
     * Gestiona el estado (nodo actual, datos del contexto).
     * Dispara “acciones de nodo” vía una interfaz (ej. `NodeExecutor`).

2. **Tipos de nodos como módulos POO**

   * En `libs/workflow-dsl/` defines:

     * Interfaces como “NodeDefinition”, “NodeExecutor”.
     * Tipos de nodos: `SendMessageNode`, `AskForDateNode`, `CreateReservationNode`, `CallLLMNode`, `WaitForUserReplyNode`, etc.
   * Cada tipo de nodo se implementa como clase:

     * Encapsula la lógica para un paso concreto (por ej., reservar en barbería vs. restaurante se parametriza por “tipo de recurso” y no por código distinto).

3. **Definiciones por tenant (multi-empresa)**

   * En `configs/tenants/<tenant>/workflows/` describes:

     * Los nodos y edges (grafo de estados).
     * Los textos y plantillas se referencian desde `messages/`.
   * El engine no sabe si es un restaurante o un hotel: sólo ejecuta el grafo.

4. **Microservicios de dominio “detrás” de los nodos**

   * Un `CreateReservationNode` no habla directo con Firestore:

     * Llama al microservicio `reservations` (REST o Pub/Sub).
   * Un `ChargePaymentNode` llama al microservicio `payments`.
   * Un `CallLLMNode` llama al `llm-proxy`.

Con esto:

* **Los workflows son distintos por negocio**, pero:

  * Reutilizas los mismos tipos de nodos.
  * Reutilizas los mismos microservicios de dominio.
* Si mañana necesitas un nodo nuevo (“Generar PDF de reserva”):

  * Creas una nueva clase de nodo en `libs/workflow-dsl`.
  * Lo conectas en `workflow-engine`.
  * Lo expones en las definiciones por tenant.
  * No rompes lo demás.

---

# 6. CI/CD con GitHub Actions → Cloud Run

### 6.1. Filosofía

* **Git como única fuente de verdad**:

  * Código, manifiestos de Cloud Run, Terraform, configs de tenants.
* **Pipelines pequeños y claros**:

  * Uno para CI (test/lint/build).
  * Uno para deploy a dev.
  * Uno para deploy a prod (gobernado por tags o releases).

### 6.2. Autenticación a GCP

* Usa `google-github-actions/auth` con **Workload Identity Federation**:

  * Evitas guardar claves JSON en GitHub.
  * La acción oficial de Cloud Run soporta esto de forma nativa. ([GitHub][2])

### 6.3. Workflow de CI (`ci.yml`)

Conceptualmente:

* Se dispara en cada PR y push:

  * Instala dependencias (monorepo, usando workspace/pnpm/yarn).
  * Lint + tests para todos los servicios o sólo los modificados.
  * Opcional: build de cada servicio (para detectar errores de empaquetado).

* Puedes optimizar:

  * Detectando qué carpetas de `services/` cambiaron (path filters/matriz), y sólo correr tests/build allí.

### 6.4. Deployment a Cloud Run (`deploy-dev.yml` / `deploy-prod.yml`)

A alto nivel:

* Desencadenado en:

  * `main` → deploy a `dev`.
  * Tag `v*` → deploy a `prod`.

* Pasos típicos:

  * Checkout del repo.
  * Autenticación a GCP con `google-github-actions/auth`. ([GitHub][2])
  * Build de imagen Docker de cada servicio modificado.
  * Push a Artifact Registry.
  * Llamada a `google-github-actions/deploy-cloudrun` por servicio:

    * Le pasas `service` (nombre de Cloud Run) y `image` (tag). ([GitHub][2])
    * Opcional: pasar env vars o secrets.

* Para encajar con **app-of-apps**:

  * Puedes tener una capa de Terraform en `infra/` y que el pipeline:

    * Aplique Terraform (crea/actualiza servicios, topics, etc.).
    * Después use `deploy-cloudrun` sólo para actualizar las imágenes.

### 6.5. Estrategia de ramas

* **Trunk-based simplificado**:

  * `main`: siempre desplegable.
  * Ramas cortas por feature: `feat/...`, `fix/...`.
  * PR obligatorio hacia `main` con checks verdes.

* Entornos:

  * `dev`: automáticamente desde `main`.
  * `prod`: sólo por tag o release + aprobación manual.

---

# 7. Cómo empezar (paso a paso, sin tocar todavía todo)

1. **Crear el monorepo vacío**

   * Inicializa el repo con:

     * `services/`
     * `libs/`
     * `configs/`
     * `infra/`
     * `.github/workflows/`
   * Añade un `docs/architecture.md` donde copies este diseño y lo vayas ajustando.

2. **Arrancar con 3 servicios clave**

   * `whatsapp-ingress`
   * `workflow-engine`
   * `reservations` (como primer dominio común)
   * Crea sus estructuras internas (`domain/application/infrastructure/interfaces`).

3. **Crear las primeras libs**

   * `domain-core` (Tenant, Customer, Reservation, etc.).
   * `workflow-dsl` (interfaces de nodos y estructura de un grafo simple).
   * Poco a poco vas extrayendo código común de los servicios hacia aquí.

4. **Configurar GCP básico**

   * Proyecto GCP.
   * Firestore, Pub/Sub, Cloud Run.
   * Service account para CI/CD.

5. **Montar CI mínimo**

   * `ci.yml` con:

     * Instalación de deps.
     * Lint + tests.
   * Asegúrate de que todo PR pase por ahí.

6. **Añadir deploy a dev**

   * `deploy-dev.yml`:

     * Autenticación con Workload Identity.
     * Build y `deploy-cloudrun` para los 3 servicios iniciales.

7. **Definir los primeros workflows reutilizables**

   * Define el workflow de Tacomiendo en `configs/tenants/tacomiendo/workflows`.
   * Refactoriza lo que veas que puede ser genérico:

     * `AskForDateNode`, `ConfirmReservationNode`, etc.
   * Crea un segundo tenant (p. ej. barbería) obligándote a parametrizar, no copiar.
