import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Add auth token if available
    const token = localStorage.getItem('auth-token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth and redirect to login
      localStorage.removeItem('auth-token')
      // No /login route exists — App shows LoginPage whenever the token is absent
      if (window.location.pathname !== '/') window.location.href = '/'
      else window.location.reload()
    }
    return Promise.reject(error)
  }
)

export default api
