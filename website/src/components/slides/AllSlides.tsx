import React, { useState } from 'react'
import { config, PILOT_CYCLE } from '../../config/presentation'

// Slide 2: Problem
export const ProblemSlide: React.FC = () => (
  <section className="slide snap-start bg-gradient-to-b from-dorn-panel/30 to-transparent">
    <div className="max-w-5xl mx-auto px-4 space-y-12 text-center animate-slide-up">
      <div className="space-y-6">
        <h2 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-dorn-text">
          A veces no muere la máquina.
          <br />
          Muere su control.
        </h2>
        <p className="text-lg sm:text-xl text-dorn-text-secondary max-w-2xl mx-auto">
          Una placa dañada u obsoleta puede detener un equipo que todavía conserva valor mecánico y productivo.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 mt-12">
        <div className="panel-bg p-8 space-y-4">
          <div className="text-4xl">⚙️</div>
          <h3 className="text-xl font-bold">Máquina funcional</h3>
          <p className="text-dorn-text-secondary">Estructura y mecanismos en buen estado</p>
        </div>
        <div className="panel-bg p-8 space-y-4 border-2 border-dorn-alert">
          <div className="text-4xl">🔴</div>
          <h3 className="text-xl font-bold text-dorn-alert">Punto de falla</h3>
          <p className="text-dorn-text-secondary">Control electrónico dañado u obsoleto</p>
        </div>
      </div>
    </div>
  </section>
)

// Slide 3: Solution
export const SolutionSlide: React.FC = () => (
  <section className="slide snap-start">
    <div className="max-w-5xl mx-auto px-4 space-y-12 text-center animate-slide-up">
      <h2 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-dorn-text">
        DORN le da una segunda vida.
      </h2>

      <div className="grid md:grid-cols-2 gap-6 mt-12">
        {[
          { icon: '💻', title: 'Interfaz', desc: 'Control moderno desde PC y móvil' },
          { icon: '🛡️', title: 'Control local', desc: 'Decisiones verificables sin depender de IA' },
          { icon: '🔧', title: 'Adaptación', desc: 'Compatible con máquinas existentes' },
          { icon: '📊', title: 'Acompañamiento', desc: 'Soporte y continuidad garantizados' },
        ].map((item, i) => (
          <div key={i} className="panel-bg p-8 space-y-4">
            <div className="text-5xl">{item.icon}</div>
            <h3 className="text-xl font-bold">{item.title}</h3>
            <p className="text-dorn-text-secondary">{item.desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-16 text-2xl font-serif italic text-dorn-accent">
        "No reemplazar la máquina. Recuperar su control."
      </div>
    </div>
  </section>
)

// Slide 4: Ecosystem
export const EcosystemSlide: React.FC = () => (
  <section className="slide snap-start bg-gradient-to-b from-transparent to-dorn-panel/20">
    <div className="max-w-6xl mx-auto px-4 space-y-12 animate-slide-up">
      <h2 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-center text-dorn-text mb-16">
        Ecosistema DORN
      </h2>

      {/* Flow diagram */}
      <div className="space-y-6">
        {[
          { label: 'DORN AI', desc: 'Comprende y coordina', accent: true },
          { label: 'PC / Móvil', desc: 'Interfaz de control' },
          { label: 'ESP32-S3', desc: 'Controlador local' },
          { label: 'Validación', desc: 'Control autorizado' },
          { label: 'Máquina', desc: 'Acción física segura' },
        ].map((item, i) => (
          <div key={i} className="space-y-4">
            <div
              className={`panel-bg p-6 rounded-lg ${item.accent ? 'border-2 border-dorn-accent' : ''}`}
            >
              <div className="font-bold text-lg text-dorn-accent">{item.label}</div>
              <div className="text-dorn-text-secondary">{item.desc}</div>
            </div>
            {i < 4 && (
              <div className="flex justify-center">
                <div className="text-dorn-text-secondary">↓</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="panel-bg p-6 mt-12 border-2 border-dorn-safe">
        <p className="text-dorn-text font-semibold">
          ✓ La IA no escribe libremente sobre el relé.
          <br />
          ✓ Control local y parada manual siempre disponibles.
        </p>
      </div>
    </div>
  </section>
)

// Slide 5: Nanobubbles Demo
export const NanobubblesDemo: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>(['Sistema listo'])

  const startDemo = () => {
    setIsRunning(true)
    const newLog = `[${new Date().toLocaleTimeString()}] Bomba iniciada - Ciclo 15min ON / 22min OFF`
    setLogs((prev) => [...prev, newLog])
  }

  const stopDemo = () => {
    setIsRunning(false)
    const newLog = `[${new Date().toLocaleTimeString()}] Bomba detenida (parada manual)`
    setLogs((prev) => [...prev, newLog])
  }

  return (
    <section className="slide snap-start">
      <div className="max-w-5xl mx-auto px-4 space-y-8 animate-fade-in">
        <h2 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-center text-dorn-text">
          Demostración: Nanoburbujas 01
        </h2>

        <div className="grid md:grid-cols-2 gap-8 mt-12">
          {/* Control Panel */}
          <div className="panel-bg p-8 space-y-6">
            <div className="space-y-2">
              <h3 className="text-xl font-bold">Bomba 12V</h3>
              <div className="text-xs bg-dorn-panel px-3 py-1 rounded w-fit text-dorn-tech">
                SIMULADO
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-dorn-text-secondary">Encendida</div>
                  <div className="text-2xl font-bold text-dorn-safe">{PILOT_CYCLE.ON_MINUTES} min</div>
                </div>
                <div>
                  <div className="text-sm text-dorn-text-secondary">Detenida</div>
                  <div className="text-2xl font-bold text-dorn-alert">{PILOT_CYCLE.OFF_MINUTES} min</div>
                </div>
              </div>

              {isRunning && (
                <div className="flex gap-2 items-center justify-center p-4 bg-dorn-safe/10 rounded-lg">
                  <div className="w-3 h-3 bg-dorn-safe rounded-full animate-pulse" />
                  <span className="text-dorn-safe font-semibold">EN FUNCIONAMIENTO</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <button
                onClick={startDemo}
                disabled={isRunning}
                className="btn btn-primary w-full"
              >
                Iniciar demo
              </button>
              <button
                onClick={stopDemo}
                disabled={!isRunning}
                className="btn btn-secondary w-full"
              >
                Detener
              </button>
            </div>

            <div className="p-4 bg-dorn-panel rounded-lg border border-dorn-panel-secondary">
              <div className="text-sm font-mono text-dorn-tech">
                $ Orden de voz: "{PILOT_CYCLE.VOICE_COMMAND}"
              </div>
            </div>
          </div>

          {/* Activity Log */}
          <div className="panel-bg p-8 space-y-4">
            <h4 className="font-bold">Registro de actividad</h4>
            <div className="space-y-2 h-80 overflow-y-auto text-sm">
              {logs.map((log, i) => (
                <div key={i} className="text-dorn-text-secondary font-mono">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel-bg p-6 border-2 border-dorn-tech mt-8">
          <p className="text-center font-semibold">
            Esta interacción es puramente local. No abre red, Bluetooth, puerto serial ni relé.
          </p>
        </div>
      </div>
    </section>
  )
}

// Slide 6: Hardware Truth
export const HardwareTruthSlide: React.FC = () => (
  <section className="slide snap-start bg-gradient-to-b from-dorn-panel/20 to-transparent">
    <div className="max-w-5xl mx-auto px-4 space-y-8 animate-slide-up">
      <h2 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-center text-dorn-text">
        Prototipo sin maquillaje
      </h2>

      <div className="grid md:grid-cols-2 gap-6 mt-12">
        {/* P4 */}
        <div className="panel-bg border-2 border-dorn-alert p-8">
          <div className="space-y-4">
            <div className="text-5xl">⚠️</div>
            <h3 className="text-2xl font-bold">ESP32-P4</h3>
            <p className="text-dorn-text-secondary">Solo exhibición</p>
            <p className="text-sm text-dorn-text-secondary">
              Pantalla defectuosa de fábrica. Representa la consola objetivo. No operativa.
            </p>
          </div>
        </div>

        {/* S3 */}
        <div className="panel-bg border-2 border-dorn-tech p-8">
          <div className="space-y-4">
            <div className="text-5xl">🔧</div>
            <h3 className="text-2xl font-bold">ESP32-S3</h3>
            <p className="text-dorn-text-secondary">Controlador de respaldo</p>
            <p className="text-sm text-dorn-text-secondary">
              Programado en Arduino IDE. Requiere prueba previa documentada.
            </p>
          </div>
        </div>
      </div>

      <div className="panel-bg border-2 border-dorn-safe p-8 mt-12">
        <div className="space-y-4">
          <div className="text-5xl">🛡️</div>
          <h3 className="text-2xl font-bold">Modo seguro · Siempre disponible</h3>
          <p className="text-dorn-text-secondary">
            Demostración en PC/móvil sin acción física. Simula comportamiento sin requerir hardware operativo.
          </p>
        </div>
      </div>

      <div className="panel-bg p-6 border-2 border-dorn-accent mt-12">
        <p className="font-semibold text-dorn-text">
          La falla del P4 es una prueba de honestidad y resiliencia. DORN bloquea la acción física si la validación falla.
        </p>
      </div>
    </div>
  </section>
)

// Slide 7: Product Experience
export const ProductExperienceSlide: React.FC = () => (
  <section className="slide snap-start">
    <div className="max-w-5xl mx-auto px-4 space-y-12 animate-slide-up">
      <h2 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-center text-dorn-text">
        Producto y experiencia
      </h2>

      <div className="grid md:grid-cols-3 gap-6 mt-12">
        {[
          {
            title: 'DORN AI',
            features: ['Generación de código', 'Orquestación de tareas', 'Contexto y recuperación'],
          },
          {
            title: 'DORN Machine',
            features: ['Interfaz de control', 'Monitoreo en tiempo real', 'Historial seguro'],
          },
          {
            title: 'DORN Machines Mobile',
            features: ['Aplicación PWA', 'Modo offline', 'Control gestual'],
          },
        ].map((item, i) => (
          <div key={i} className="panel-bg p-8 space-y-4">
            <h3 className="text-xl font-bold text-dorn-accent">{item.title}</h3>
            <ul className="space-y-2 text-sm">
              {item.features.map((feature, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span className="text-dorn-accent mt-1">▸</span>
                  <span className="text-dorn-text-secondary">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mt-12">
        <div className="panel-bg p-8">
          <h4 className="font-bold mb-4">Datos clasificados</h4>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2">
              <span className="text-dorn-safe">●</span>
              <span>REAL: Datos medidos</span>
            </li>
            <li className="flex gap-2">
              <span className="text-dorn-tech">●</span>
              <span>SIMULATED: Demostración</span>
            </li>
            <li className="flex gap-2">
              <span className="text-dorn-text-secondary">●</span>
              <span>DEMO: Previsualización</span>
            </li>
          </ul>
        </div>
        <div className="panel-bg p-8">
          <h4 className="font-bold mb-4">Garantías</h4>
          <ul className="space-y-2 text-sm">
            <li>✓ Control local verificable</li>
            <li>✓ Recuperación y continuidad</li>
            <li>✓ Historial completo y auditable</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
)

// Slide 8: Business Model
export const BusinessModelSlide: React.FC = () => (
  <section className="slide snap-start bg-gradient-to-b from-transparent to-dorn-panel/20">
    <div className="max-w-5xl mx-auto px-4 space-y-12 animate-slide-up">
      <h2 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-center text-dorn-text">
        Modelo de negocio
      </h2>

      <div className="grid md:grid-cols-3 gap-6 mt-12">
        {config.revenue.model.map((item, i) => (
          <div key={i} className="panel-bg p-8 border-t-2 border-dorn-accent space-y-4">
            <h3 className="text-2xl font-bold text-dorn-accent">{i + 1}</h3>
            <h4 className="text-xl font-bold">{item.item}</h4>
            <p className="text-dorn-text-secondary">{item.description}</p>
          </div>
        ))}
      </div>

      <div className="panel-bg p-8 mt-12 border-2 border-dorn-safe">
        <div className="space-y-4">
          <h4 className="font-bold text-lg">Incluido en el kit</h4>
          <p className="text-dorn-text-secondary">
            6 meses de servicio DORN incluidos en la compra inicial
          </p>
        </div>
      </div>

      <div className="panel-bg p-8 border-2 border-dorn-tech">
        <h4 className="font-bold text-lg mb-3">Cliente inicial</h4>
        <ul className="space-y-2 text-dorn-text-secondary">
          {config.customers.initial.map((customer, i) => (
            <li key={i}>• {customer}</li>
          ))}
        </ul>
      </div>

      <div className="bg-dorn-alert/10 border border-dorn-alert rounded-lg p-6 mt-8">
        <p className="text-sm text-dorn-text-secondary">
          Nota: Precio, número de clientes, ahorro e impacto no están validados. Se actualizará con datos reales.
        </p>
      </div>
    </div>
  </section>
)

// Slide 9: Evidence & Status
export const EvidenceMatrixSlide: React.FC = () => (
  <section className="slide snap-start">
    <div className="max-w-5xl mx-auto px-4 space-y-12 animate-slide-up">
      <h2 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-center text-dorn-text">
        Estado real del proyecto
      </h2>

      <div className="grid md:grid-cols-2 gap-6 mt-12">
        {/* Proven */}
        <div className="panel-bg border-2 border-dorn-safe p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="text-2xl">✓</div>
            <h3 className="text-2xl font-bold text-dorn-safe">Demostrable</h3>
          </div>
          <ul className="space-y-3 text-sm">
            {config.status.proven.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="text-dorn-safe font-bold">✓</span>
                <span className="text-dorn-text-secondary">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Pending */}
        <div className="panel-bg border-2 border-dorn-alert p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="text-2xl">⏳</div>
            <h3 className="text-2xl font-bold text-dorn-alert">Pendiente</h3>
          </div>
          <ul className="space-y-3 text-sm">
            {config.status.pending.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="text-dorn-alert font-bold">•</span>
                <span className="text-dorn-text-secondary">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel-bg p-8 border-2 border-dorn-tech mt-12">
        <div className="text-center">
          <div className="text-lg font-mono text-dorn-tech font-bold">
            Estado: {config.status.overall}
          </div>
          <p className="text-sm text-dorn-text-secondary mt-3">
            Piloto en validación · Listo para pruebas con cliente inicial
          </p>
        </div>
      </div>
    </div>
  </section>
)

// Slide 10: Closing
export const ClosingSlide: React.FC<{
  onContactCTA: () => void
  onMobileApp: () => void
}> = ({ onContactCTA, onMobileApp }) => (
  <section className="slide snap-start flex flex-col justify-center">
    <div className="max-w-5xl mx-auto px-4 text-center space-y-12 animate-fade-in">
      <h2 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-dorn-text">
        La próxima máquina no tiene que terminar como residuo.
      </h2>

      <p className="text-xl sm:text-2xl text-dorn-text-secondary max-w-3xl mx-auto leading-relaxed">
        Buscamos una pyme, un técnico o una organización que quiera validar con nosotros la primera familia de máquinas compatibles.
      </p>

      <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
        <button
          onClick={onContactCTA}
          className="btn btn-primary text-lg px-8 py-4 min-h-[56px] sm:min-h-[44px] w-full sm:w-auto"
        >
          Construyamos el primer piloto
        </button>
        <button
          onClick={onMobileApp}
          className="btn btn-secondary text-lg px-8 py-4 min-h-[56px] sm:min-h-[44px] w-full sm:w-auto"
        >
          Ver DORN Machines Mobile
        </button>
      </div>

      <div className="text-dorn-text-secondary text-sm mt-12">
        <p>
          Universidad Católica de Chillán · {new Date(config.event.date).toLocaleDateString('es-CL')}
        </p>
      </div>
    </div>
  </section>
)
