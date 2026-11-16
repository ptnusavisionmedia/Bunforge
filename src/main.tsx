import { createRoot } from 'react-dom/client'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import '@fontsource/barlow-condensed/latin-800.css'
import '@fontsource-variable/inter/wght.css'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
