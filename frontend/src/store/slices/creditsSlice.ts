import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import axios from 'axios';

export const fetchBalance = createAsyncThunk('credits/fetch', async (_, thunkAPI) => {
  const res = await axios.get('/api/credits', { withCredentials: true });
  return res.data.balance;
});

const slice = createSlice({
  name: 'credits',
  initialState: { balance: 0, loading: false, error: null } as any,
  reducers: {
    setBalance(state, action: PayloadAction<number>) { state.balance = action.payload; },
    adjust(state, action: PayloadAction<number>) { state.balance += action.payload; },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchBalance.pending, (state) => { state.loading = true; state.error = null; });
    builder.addCase(fetchBalance.fulfilled, (state, action) => { state.loading = false; state.balance = action.payload; });
    builder.addCase(fetchBalance.rejected, (state, action) => { state.loading = false; state.error = action.error.message; });
  },
});

export const { setBalance, adjust } = slice.actions;
export default slice.reducer;
