// Noise XK transport for P2P chat completions with chunked exchange.
//
// Wire protocol v2 (HTTP):
//   POST {endpoint}/p2p/noise/handshake
//     body  = msg1                                          (-> e)
//     reply = msg2                                          (<- e, ee)
//             with X-P2P-Session: <id>
//   POST {endpoint}/p2p/noise/exchange
//     header X-P2P-Session: <id>
//     body   = [u32 BE msg3_len][msg3]
//              [u32 BE n_chunks][for each: u32 BE chunk_len + ct]
//              msg3 (-> s, se) carries an empty Noise plaintext; the JSON
//              request is framed as N transport-mode chunks
//              (CHUNK_PT plaintext bytes each, max ~64 KB after AEAD tag).
//     reply  = [u32 BE n_chunks][for each: u32 BE chunk_len + ct]
//
// Chunking lets us ferry large payloads (e.g. base64-encoded images for OCR
// or vision) that overflow the 65535-byte ceiling of a single Noise message.
//
// Both sides use the standard pattern `Noise_XK_25519_ChaChaPoly_BLAKE2s`.
// Responder's static pubkey comes from the matchmaking row (`provider.publicKey`).
// Initiator's static keypair is per-app, persisted at first run — see
// `load_or_create_static_keys`. The matchmaker never sees plaintext.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use snow::Builder;
use std::path::PathBuf;

const NOISE_PARAMS: &str = "Noise_XK_25519_ChaChaPoly_BLAKE2s";
const HANDSHAKE_BUF: usize = 65535;
const CHUNK_CT_MAX: usize = 65535;
const CHUNK_PT: usize = 65000;
const MAX_PT_RESPONSE: usize = 32 * 1024 * 1024;

fn keys_path() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir().ok_or_else(|| "no local data dir".to_string())?;
    let dir = base.join("Monkey");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("p2p_static_key.bin"))
}

fn load_or_create_static_keys() -> Result<(Vec<u8>, Vec<u8>), String> {
    let path = keys_path()?;
    if path.exists() {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() == 64 {
            let priv_key = bytes[..32].to_vec();
            let pub_key = bytes[32..].to_vec();
            return Ok((priv_key, pub_key));
        }
    }
    let builder = Builder::new(NOISE_PARAMS.parse().map_err(|e: snow::Error| e.to_string())?);
    let kp = builder.generate_keypair().map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(64);
    buf.extend_from_slice(&kp.private);
    buf.extend_from_slice(&kp.public);
    std::fs::write(&path, &buf).map_err(|e| e.to_string())?;
    Ok((kp.private, kp.public))
}

#[derive(Serialize)]
pub struct StaticPubKey {
    pub public_key_b64: String,
}

#[tauri::command]
pub fn p2p_static_pubkey() -> Result<StaticPubKey, String> {
    let (_priv, pub_key) = load_or_create_static_keys()?;
    Ok(StaticPubKey { public_key_b64: B64.encode(pub_key) })
}

#[tauri::command]
pub async fn p2p_noise_chat(
    endpoint: String,
    provider_pubkey_b64: String,
    request_json: String,
) -> Result<String, String> {
    let rs = B64.decode(&provider_pubkey_b64).map_err(|e| e.to_string())?;
    if rs.len() != 32 {
        return Err(format!("provider pubkey must be 32 bytes, got {}", rs.len()));
    }
    let (priv_key, _pub_key) = load_or_create_static_keys()?;

    let params: snow::params::NoiseParams =
        NOISE_PARAMS.parse().map_err(|e: snow::Error| e.to_string())?;
    let mut initiator = Builder::new(params)
        .local_private_key(&priv_key)
        .remote_public_key(&rs)
        .build_initiator()
        .map_err(|e| e.to_string())?;

    // -> e
    let mut msg1 = [0u8; HANDSHAKE_BUF];
    let n = initiator.write_message(&[], &mut msg1).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(false)
        .build()
        .map_err(|e| e.to_string())?;

    let hs_resp = client
        .post(format!("{}/p2p/noise/handshake", endpoint.trim_end_matches('/')))
        .header("Content-Type", "application/octet-stream")
        .body(msg1[..n].to_vec())
        .send()
        .await
        .map_err(|e| format!("handshake send: {e}"))?;

    if !hs_resp.status().is_success() {
        return Err(format!("handshake HTTP {}", hs_resp.status()));
    }
    let session_id = hs_resp
        .headers()
        .get("X-P2P-Session")
        .ok_or_else(|| "missing X-P2P-Session header".to_string())?
        .to_str()
        .map_err(|e| e.to_string())?
        .to_string();
    let msg2 = hs_resp.bytes().await.map_err(|e| e.to_string())?;

    // <- e, ee
    let mut payload_buf = [0u8; HANDSHAKE_BUF];
    initiator
        .read_message(&msg2, &mut payload_buf)
        .map_err(|e| format!("read msg2: {e}"))?;

    // -> s, se   (handshake finishing message; empty Noise plaintext in v2.
    // The JSON request rides in framed transport chunks below.)
    let mut msg3 = vec![0u8; HANDSHAKE_BUF];
    let n3 = initiator
        .write_message(&[], &mut msg3)
        .map_err(|e| format!("write msg3: {e}"))?;
    msg3.truncate(n3);

    let mut transport = initiator.into_transport_mode().map_err(|e| e.to_string())?;

    // Frame the body: [u32 BE msg3_len][msg3][u32 BE n_chunks][chunks...]
    let pt = request_json.as_bytes();
    let n_chunks = if pt.is_empty() {
        1
    } else {
        (pt.len() + CHUNK_PT - 1) / CHUNK_PT
    };

    let mut body = Vec::with_capacity(8 + msg3.len() + pt.len() + n_chunks * (4 + 16));
    body.extend_from_slice(&(msg3.len() as u32).to_be_bytes());
    body.extend_from_slice(&msg3);
    body.extend_from_slice(&(n_chunks as u32).to_be_bytes());

    let mut ct_buf = vec![0u8; CHUNK_CT_MAX];
    for i in 0..n_chunks {
        let start = i * CHUNK_PT;
        let end = (start + CHUNK_PT).min(pt.len());
        let slice: &[u8] = if pt.is_empty() { &[] } else { &pt[start..end] };
        let n = transport
            .write_message(slice, &mut ct_buf)
            .map_err(|e| format!("encrypt chunk {i}: {e}"))?;
        body.extend_from_slice(&(n as u32).to_be_bytes());
        body.extend_from_slice(&ct_buf[..n]);
    }

    let ex_resp = client
        .post(format!("{}/p2p/noise/exchange", endpoint.trim_end_matches('/')))
        .header("Content-Type", "application/octet-stream")
        .header("X-P2P-Session", &session_id)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("exchange send: {e}"))?;

    if !ex_resp.status().is_success() {
        return Err(format!("exchange HTTP {}", ex_resp.status()));
    }
    let ct_body = ex_resp.bytes().await.map_err(|e| e.to_string())?;

    let mut cur = 0usize;
    let n_resp_chunks =
        read_u32(&ct_body, &mut cur).ok_or_else(|| "truncated response n_chunks".to_string())?;
    let mut out: Vec<u8> = Vec::with_capacity(8192);
    let mut chunk_pt = vec![0u8; CHUNK_CT_MAX];
    for i in 0..n_resp_chunks {
        let ct_len = read_u32(&ct_body, &mut cur)
            .ok_or_else(|| format!("truncated response chunk len {i}"))?;
        let ct = slice_at(&ct_body, &mut cur, ct_len)
            .ok_or_else(|| format!("truncated response chunk {i}"))?;
        let n = transport
            .read_message(ct, &mut chunk_pt)
            .map_err(|e| format!("decrypt response chunk {i}: {e}"))?;
        if out.len() + n > MAX_PT_RESPONSE {
            return Err("response too large".to_string());
        }
        out.extend_from_slice(&chunk_pt[..n]);
    }

    String::from_utf8(out).map_err(|e| format!("response not utf8: {e}"))
}

fn read_u32(body: &[u8], cur: &mut usize) -> Option<u32> {
    let end = cur.checked_add(4)?;
    if end > body.len() {
        return None;
    }
    let v = u32::from_be_bytes([body[*cur], body[*cur + 1], body[*cur + 2], body[*cur + 3]]);
    *cur = end;
    Some(v)
}

fn slice_at<'a>(body: &'a [u8], cur: &mut usize, len: u32) -> Option<&'a [u8]> {
    let len = len as usize;
    let end = cur.checked_add(len)?;
    let s = body.get(*cur..end)?;
    *cur = end;
    Some(s)
}
