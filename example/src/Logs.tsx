import { useState } from 'react'
import { useMissionControl } from './MissionControlContext'

const pluginRef = import.meta.env.VITE_PLUGIN_REF || 'kubernetes-logs'
const defaultConfigId = import.meta.env.VITE_CONFIG_ID || 'a8ef370b-dd95-4896-bb2a-5719df8c274b'

type ResultState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; statusCode: number; body: string }
  | { status: 'error'; message: string }

type PodRow = {
  namespace: string
  pod: string
  phase: string
  ownedBy?: string
}

export function Logs() {
  const mc = useMissionControl()
  const [configId, setConfigId] = useState(defaultConfigId)
  const [namespace, setNamespace] = useState('default')
  const [pod, setPod] = useState('')
  const [container, setContainer] = useState('')
  const [tail, setTail] = useState('100')
  const [result, setResult] = useState<ResultState>({ status: 'idle' })
  const [events, setEvents] = useState<string[]>([])
  const [pods, setPods] = useState<PodRow[]>([])

  async function onClickListPods() {
    setResult({ status: 'loading' })
    setEvents([])

    try {
      const res = await mc.plugin(pluginRef, { configId: configId || undefined }).invoke('list-pods')
      const text = await res.text()
      const rows = JSON.parse(text) as PodRow[]
      setPods(rows)
      if (rows[0]) {
        setNamespace(rows[0].namespace)
        setPod(rows[0].pod)
      }
      setResult({
        status: 'success',
        statusCode: res.status,
        body: JSON.stringify(rows, null, 2),
      })
    } catch (err) {
      setResult({ status: 'error', message: String(err) })
    }
  }

  async function onClickInvoke() {
    setResult({ status: 'loading' })
    setEvents([])

    try {
      const res = await mc.plugin(pluginRef, { configId: configId || undefined }).invoke('logs', {
        namespace,
        pod: pod || undefined,
        container: container || undefined,
        tailLines: Number(tail) || undefined,
        follow: false,
      })

      const text = await res.text()
      setResult({
        status: 'success',
        statusCode: res.status,
        body: pretty(text),
      })
    } catch (err) {
      setResult({ status: 'error', message: String(err) })
    }
  }

  function onClickStream() {
    setEvents([])
    setResult({ status: 'idle' })

    try {
      const source = mc.plugin(pluginRef, { configId: configId || undefined }).stream('logs', {
        namespace,
        pod: pod || undefined,
        container: container || undefined,
        tailLines: Number(tail) || undefined,
        follow: true,
      })

      source.onmessage = event => {
        setEvents(prev => [...prev.slice(-200), event.data])
      }
      source.onerror = () => {
        setEvents(prev => [...prev, '[stream error/closed]'])
        source.close()
      }
    } catch (err) {
      setResult({ status: 'error', message: String(err) })
    }
  }

  return (
    <div className="logs-layout">
      <section className="card config-card">
        <label>
          Config ID
          <input
            value={configId}
            onChange={e => setConfigId(e.target.value)}
            placeholder="Mission Control config id"
          />
        </label>


        <div className="grid">
          <label>
            Namespace
            <input value={namespace} onChange={e => setNamespace(e.target.value)} />
          </label>

          <label>
            Pod
            <select
              value={pod}
              onChange={e => {
                const selected = pods.find(row => row.pod === e.target.value)
                if (selected) setNamespace(selected.namespace)
                setPod(e.target.value)
              }}
            >
              {pod && !pods.some(row => row.pod === pod) && <option value={pod}>{pod}</option>}
              <option value="">Select pod</option>
              {pods.map(row => (
                <option key={`${row.namespace}/${row.pod}`} value={row.pod}>
                  {row.namespace}/{row.pod} ({row.phase})
                </option>
              ))}
            </select>
          </label>

          <label>
            Container
            <input
              value={container}
              onChange={e => setContainer(e.target.value)}
              placeholder="optional"
            />
          </label>

          <label>
            Tail
            <input value={tail} onChange={e => setTail(e.target.value)} />
          </label>
        </div>

        <div className="actions">
          <button onClick={onClickListPods}>List Pods</button>
          <button onClick={onClickInvoke}>Invoke Logs</button>
          <button onClick={onClickStream}>Stream Logs</button>
        </div>

        {pods.length > 0 && (
          <div className="pods">
            <h3>Pods</h3>
            <table>
              <thead>
                <tr>
                  <th>Namespace</th>
                  <th>Pod</th>
                  <th>Phase</th>
                  <th>Owned By</th>
                </tr>
              </thead>
              <tbody>
                {pods.map(row => (
                  <tr
                    key={`${row.namespace}/${row.pod}`}
                    onClick={() => {
                      setNamespace(row.namespace)
                      setPod(row.pod)
                    }}
                  >
                    <td>{row.namespace}</td>
                    <td>{row.pod}</td>
                    <td>{row.phase}</td>
                    <td>{row.ownedBy || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card logs-viewer">
        <h2>Logs Viewer</h2>
        {result.status === 'idle' && <p>No request yet.</p>}
        {result.status === 'loading' && <p>Loading...</p>}
        {result.status === 'error' && <pre className="error">{result.message}</pre>}
        {result.status === 'success' && (
          <>
            <p>Status: {result.statusCode}</p>
            <pre>{result.body}</pre>
          </>
        )}
        {events.length > 0 && <pre>{events.join('\n')}</pre>}
      </section>
    </div>
  )
}

function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
