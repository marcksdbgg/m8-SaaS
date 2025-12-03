Plan Maestro de Arquitectura de Backend: Motor SaaS de Orquestación de Negocios

Versión: 2.0.0 - Enterprise Ready
Arquitectura: Event-Driven Microservices (Hexagonal)
Infraestructura: Google Cloud Platform (Serverless)

1. Resumen Ejecutivo

El sistema se define como una plataforma SaaS Multi-tenant diseñada para orquestar procesos de negocio complejos (pedidos, reservas, pagos) a través de canales de mensajería como WhatsApp.

La arquitectura abandona el modelo monolítico tradicional en favor de un Motor de Ejecución de Workflows Distribuido. La lógica de negocio no está escrita en el código del núcleo, sino que se define como grafos de datos (JSON) que son interpretados por un motor agnóstico. Este motor delega la ejecución de tareas específicas a Microservicios de Dominio especializados, permitiendo que un solo sistema soporte miles de negocios con flujos totalmente distintos (Restaurantes, Hoteles, Barberías) reutilizando los mismos bloques lógicos.

Principios Rectores

Event-Driven (Asíncrono): Desacoplamiento total mediante Google Pub/Sub. La ingesta de mensajes es inmediata; el procesamiento es asíncrono.

Serverless First: Cómputo en Cloud Run (escala a cero) y persistencia híbrida (Cloud SQL para datos relacionales transaccionales y Firestore para configuración y estado caliente).

Modularidad POO: Implementación estricta de patrones de diseño (Strategy, Command, Chain of Responsibility) para la lógica de los nodos.

Repositorio como Fuente de Verdad: Gestión mediante Monorepo (Nx) donde la infraestructura y la lógica conviven versionadas.

2. Arquitectura de Alto Nivel

El sistema se estructura en capas concéntricas, desde la comunicación externa hasta el núcleo de datos.


graph TD
    %% Actores Externos
    User((Usuario WhatsApp)) -->|Mensaje| WA[WhatsApp Cloud API]
    Admin((Dueño Negocio)) -->|Config| CW[Chatwoot / Dashboard]

    %% Capa de Ingesta (Edge)
    WA -->|Webhook| GW[Apps: Ingress Gateway]
    CW -->|Webhook| GW
    
    %% Bus de Eventos
    GW -->|Publishes: message.received| PS[Google Pub/Sub]

    %% El Cerebro (Core)
    subgraph "Core Processing"
        PS -->|Subscribes| ENG[Apps: Workflow Engine]
        ENG <-->|Read State/Graph| FS[(Firestore: Hot State)]
        ENG <-->|Cache| REDIS[(Redis: Sessions & Locks)]
    end

    %% Servicios de Dominio (Especialistas)
    subgraph "Domain Microservices"
        ENG -->|Command: order.create| ORD[Apps: Ordering Service]
        ENG -->|Command: payment.verify| FIN[Apps: Finance Service]
        ENG -->|Command: ai.analyze| AI[Apps: Intelligence Service]
        
        ORD <-->|Read/Write| SQL[(Cloud SQL: Transactional DB)]
        FIN <-->|Read/Write| SQL
        AI -->|API Call| OPENAI[OpenAI / Gemini]
    end

    %% Salida
    Domain -->|Event: task.completed| PS
    ENG -->|Event: message.send| DISP[Apps: Dispatcher Service]
    DISP -->|API Call| WA


3. Estructura de Código: Estrategia de Monorepo (Nx + NestJS)

Para evitar la duplicidad y el "código espagueti", utilizamos un Monorepo gestionado por Nx. Esta estructura impone límites arquitectónicos estrictos.

Regla de Oro

"Las Apps importan Librerías. Las Librerías NUNCA importan Apps."

Jerarquía de Carpetas

/nyro-saas-platform
├── /apps                          # CONTENEDORES DESPLEGABLES (Cloud Run Services)
│   ├── ingress-gateway            # Recibe Webhooks, valida firmas, empuja a Pub/Sub.
│   ├── workflow-engine            # Orquestador de la máquina de estados.
│   ├── dispatcher                 # Envío de mensajes a WhatsApp (Rate Limits).
│   ├── ordering-service           # Lógica de Pedidos y Menús (SQL).
│   ├── finance-service            # Lógica de Pagos y OCR (Gemini).
│   └── intelligence-service       # Wrapper para LLMs.
│
├── /libs                          # LÓGICA DE NEGOCIO Y COMPONENTES REUTILIZABLES
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
│
└── /infrastructure                # INFRASTRUCTURE AS CODE (Terraform)


4. Modelo de Datos Híbrido

El sistema utiliza la herramienta adecuada para cada tipo de dato.

4.1. Configuración y Estado (Firestore / Redis)

Optimizado para lectura rápida y estructuras flexibles (JSON).

tenants: Configuración global del negocio (Credenciales, Prompts del sistema, Horarios).

workflows: Definición del grafo (Nodos y Conexiones). Es el "código fuente" visual del negocio.

sessions (Redis/Firestore): Estado efímero de la conversación.

{
  "sessionId": "wa_51999...",
  "currentNode": "step_ask_address",
  "context": { "cart": [...], "temp_address": "Av. Larco 123" },
  "mode": "BOT" // o "AGENT_HANDOFF"
}


4.2. Datos Transaccionales (Cloud SQL - PostgreSQL)

Optimizado para integridad referencial, reportes y consistencia financiera. Basado en tus esquemas SQL.

Tabla: clientes
Historial y perfilamiento del usuario.

CREATE TABLE clientes (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL, -- Soporte Multi-tenant
  telefono VARCHAR(32) NOT NULL,
  nombre VARCHAR(255),
  metadatos JSONB, -- Preferencias, alergias, última visita
  modo_bot BOOLEAN DEFAULT TRUE,
  UNIQUE(tenant_id, telefono)
);


Tabla: pedidos
Cabecera de las transacciones.

CREATE TABLE pedidos (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  cliente_id BIGINT REFERENCES clientes(id),
  numero_orden VARCHAR(64),
  estado VARCHAR(32) DEFAULT 'pendiente', -- PENDIENTE, PAGADO, EN_COCINA
  tipo_pedido VARCHAR(16) CHECK (tipo_pedido IN ('recojo', 'delivery')),
  total NUMERIC(10,2),
  ubicacion JSONB, -- { lat: -12..., lon: -77... }
  resumen_pedido TEXT,
  errores JSONB
);


Tabla: pagos_recibidos
Conciliación financiera.

CREATE TABLE pagos_recibidos (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  pedido_id BIGINT REFERENCES pedidos(id),
  codigo_operacion VARCHAR(64),
  monto NUMERIC(10,2),
  remitente VARCHAR(255),
  estado VARCHAR(32), -- PENDIENTE, ASIGNADO, MANUAL_REVIEW
  ocr_raw_data JSONB -- Respuesta cruda de Gemini
);


5. Comunicación y Orquestación (El Flujo)

Caso de Uso: Confirmación de Pago con Foto (Yape/Plin)

Ingesta (Ingress Gateway):

Recibe Webhook de WhatsApp (Imagen).

Identifica al Tenant.

Publica evento MessageReceived en Pub/Sub.

Responde 200 OK.

Orquestación (Workflow Engine):

Consume evento.

Carga sesión de Redis: Estado actual = ESPERANDO_PAGO.

Consulta el grafo del workflow: Si llega imagen en este estado -> Ejecutar Nodo "Validar Pago".

Emite comando VerifyPaymentCommand (con URL de imagen y ID de pedido) a Pub/Sub.

Procesamiento de Dominio (Finance Service):

Consume VerifyPaymentCommand.

Paso 1 (OCR): Envía imagen a Gemini Vision. Obtiene JSON {monto: 50.00, codigo: "12345"}.

Paso 2 (Conciliación): Consulta pedidos en Cloud SQL. Compara monto_ocr vs pedidos.total con tolerancia de S/ 0.50.

Paso 3 (Persistencia):

Si coincide: Actualiza pedidos.estado = 'PAGADO', inserta en pagos_recibidos.

Si falla: Marca pagos_recibidos.estado = 'MANUAL_REVIEW'.

Emite evento PaymentProcessedEvent (con resultado: ÉXITO o REVISIÓN).

Respuesta (Workflow Engine + Dispatcher):

Engine consume PaymentProcessedEvent.

Avanza el grafo al siguiente nodo según el resultado (Ej: "Enviar Confirmación" o "Contactar Soporte").

Emite comando SendMessage al Dispatcher Service.

Dispatcher formatea el mensaje final y lo envía a la API de WhatsApp.

6. Diseño Orientado a Objetos (POO) para Extensibilidad

Para permitir la creación de workflows personalizados sin reescribir el núcleo, utilizamos el patrón Strategy.

// libs/core-engine/src/interfaces/workflow-node.interface.ts
export interface IWorkflowNode {
  validateConfig(config: any): boolean;
  execute(context: ExecutionContext): Promise<NodeResult>;
}

// libs/core-engine/src/nodes/finance/payment-validation.node.ts
@WorkflowNode('PAYMENT_VALIDATION')
export class PaymentValidationNode implements IWorkflowNode {
  constructor(private readonly financeClient: FinanceServiceClient) {}

  async execute(ctx: ExecutionContext): Promise<NodeResult> {
    // Lógica encapsulada que delega al microservicio
    const result = await this.financeClient.verify(ctx.input.mediaUrl, ctx.state.orderId);
    
    if (result.isApproved) {
      return { nextNode: ctx.config.successPath, output: result };
    } else {
      return { nextNode: ctx.config.failurePath, output: result };
    }
  }
}


7. Pipeline CI/CD (GitHub Actions)

Automatización total basada en la detección de cambios de Nx.

Pull Request:

nx affected:lint: Revisa estilo solo en apps/libs modificadas.

nx affected:test: Ejecuta pruebas unitarias.

Merge a Main:

nx affected:build: Construye imágenes Docker optimizadas.

Push a Google Artifact Registry.

Terraform Apply: Actualiza la definición de Cloud Run (nuevas variables de entorno, secretos).

Migraciones DB: Ejecuta migraciones de TypeORM en Cloud SQL si hubo cambios en las entidades.

8. Conclusión

Esta arquitectura cumple con todos los requisitos de un sistema moderno, profesional y escalable:

Robustez: Los fallos en el servicio de OCR no detienen la recepción de mensajes.

Escalabilidad: Cloud Run maneja los picos de tráfico automáticamente.

Personalización: Nuevos tipos de negocios se configuran mediante datos (JSON), no código.

Mantenibilidad: El código está estrictamente organizado en Dominios y Capas dentro del Monorepo.