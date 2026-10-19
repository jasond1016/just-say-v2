FROM justsay-qwen-local-vllm:dev

# Reuse the existing CUDA/PyTorch image; do not download another ASR model.
RUN python -m pip install --no-cache-dir "funasr==1.3.1" "modelscope==1.36.3"

WORKDIR /workspace
COPY resources/local-service/service.py /workspace/resources/local-service/service.py

ENV JUSTSAY_LOCAL_SERVICE_HOST=0.0.0.0
ENV JUSTSAY_LOCAL_SERVICE_PORT=8765
ENV JUSTSAY_LOCAL_SERVICE_MODEL=iic/SenseVoiceSmall
ENV JUSTSAY_LOCAL_SERVICE_RUNTIME_FAMILY=sensevoice
ENV JUSTSAY_LOCAL_SERVICE_DEVICE=cuda

CMD ["python", "/workspace/resources/local-service/service.py"]
