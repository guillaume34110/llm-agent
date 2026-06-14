import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

async function fetchCsrf() {
  try {
    await axios.get('/api/auth/csrf', { withCredentials: true });
    const token = document.cookie.split('; ').find(r => r.startsWith('XSRF-TOKEN='))?.split('=')[1];
    if (token) axios.defaults.headers.common['X-XSRF-TOKEN'] = decodeURIComponent(token);
  } catch { /* ignore in dev */ }
}

export const fetchMe = createAsyncThunk('auth/fetchMe', async () => {
  const res = await axios.get('/api/auth/me', { withCredentials: true });
  return res.data;
});

export const register = createAsyncThunk('auth/register', async ({ email, password }: { email: string; password: string }) => {
  await fetchCsrf();
  const res = await axios.post('/api/auth/register', { email, password }, { withCredentials: true });
  return res.data;
});

export const login = createAsyncThunk('auth/login', async ({ email, password, rememberMe }: { email: string; password: string; rememberMe?: boolean }) => {
  await fetchCsrf();
  const res = await axios.post('/api/auth/login', { email, password, rememberMe }, { withCredentials: true });
  return res.data;
});

export const logout = createAsyncThunk('auth/logout', async () => {
  await fetchCsrf();
  await axios.post('/api/auth/logout', {}, { withCredentials: true });
  return true;
});

export const changePassword = createAsyncThunk('auth/changePassword', async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
  const res = await axios.post('/api/auth/change-password', { currentPassword, newPassword }, { withCredentials: true });
  return res.data;
});

export const forgotPassword = createAsyncThunk('auth/forgotPassword', async (email: string) => {
  const res = await axios.post('/api/auth/forgot-password', { email }, { withCredentials: true });
  return res.data;
});

export const resetPassword = createAsyncThunk('auth/resetPassword', async ({ token, password }: { token: string; password: string }) => {
  const res = await axios.post('/api/auth/reset-password', { token, password }, { withCredentials: true });
  return res.data;
});

const slice = createSlice({
  name: 'auth',
  initialState: { user: null, loading: false, error: null } as any,
  reducers: {
    setUser(state, action) { state.user = action.payload; },
    clearAuth(state) { state.user = null; state.error = null; state.loading = false; },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchMe.pending, (state) => { state.loading=true; state.error=null; });
    builder.addCase(fetchMe.fulfilled, (state, action) => { state.loading=false; state.user = action.payload; });
    builder.addCase(fetchMe.rejected, (state, action) => { state.loading=false; state.error = action.error.message; state.user = null; });

    builder.addCase(register.pending, (state) => { state.loading=true; state.error=null; });
    builder.addCase(register.fulfilled, (state, action) => { state.loading=false; state.user = action.payload.user ?? action.payload; });
    builder.addCase(register.rejected, (state, action) => { state.loading=false; state.error = action.error.message; });

    builder.addCase(login.pending, (state) => { state.loading=true; state.error=null; });
    builder.addCase(login.fulfilled, (state, action) => { state.loading=false; state.user = action.payload.user ?? action.payload; });
    builder.addCase(login.rejected, (state, action) => { state.loading=false; state.error = action.error.message; });

    builder.addCase(logout.fulfilled, (state) => { state.user = null; });
  },
});

export const { setUser, clearAuth } = slice.actions;
export default slice.reducer;
