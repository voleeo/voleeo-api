//! `DynamicCodec` — the keystone. A `tonic::codec::Codec` over
//! `prost_reflect::DynamicMessage`, so one `tonic::client::Grpc` can carry the
//! request/response messages of any method without generated structs. The
//! encoder is descriptorless (encoding only needs the message itself); the
//! decoder holds the output `MessageDescriptor` to build the right message.

use prost::Message;
use prost_reflect::{DynamicMessage, MessageDescriptor};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::Status;

pub struct DynamicCodec {
    /// Descriptor of the message this codec decodes (the wire response).
    decode_desc: MessageDescriptor,
}

impl DynamicCodec {
    /// `decode_desc` is the message the *peer sends us*: the response message for
    /// a client call (unary/streaming both decode the server's output).
    pub fn new(decode_desc: MessageDescriptor) -> Self {
        Self { decode_desc }
    }
}

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder {
            desc: self.decode_desc.clone(),
        }
    }
}

pub struct DynamicEncoder;

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        // prost frames the length; we write the bare message body.
        Message::encode(&item, dst).map_err(|e| Status::internal(format!("grpc encode: {e}")))
    }
}

pub struct DynamicDecoder {
    desc: MessageDescriptor,
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        // tonic hands us exactly one message's bytes per call.
        let msg = DynamicMessage::decode(self.desc.clone(), src)
            .map_err(|e| Status::internal(format!("grpc decode: {e}")))?;
        Ok(Some(msg))
    }
}
