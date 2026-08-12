#!/usr/bin/env bash
set -euo pipefail

ARC_VERSION=0.14.2
K3S_VERSION=v1.36.3+k3s1
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [[ $EUID -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

for command in curl helm; do
  if ! command -v "$command" >/dev/null; then
    echo "$command is required." >&2
    exit 1
  fi
done

if command -v k3s >/dev/null; then
  if ! k3s --version | grep -Fq "k3s version $K3S_VERSION "; then
    echo "Existing k3s installation does not match $K3S_VERSION." >&2
    exit 1
  fi
  if ! systemctl is-active --quiet k3s; then
    echo "Existing k3s service is not active." >&2
    exit 1
  fi
  for required_flag in --disable=traefik --disable=servicelb --secrets-encryption; do
    if ! systemctl cat k3s | grep -Fq -- "$required_flag"; then
      echo "Existing k3s service is missing $required_flag." >&2
      exit 1
    fi
  done
else
  curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="$K3S_VERSION" \
    sh -s - server --disable=traefik --disable=servicelb --secrets-encryption
fi

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

kubectl create namespace arc-system --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace arc-runners --dry-run=client -o yaml | kubectl apply -f -

if ! kubectl -n arc-runners get secret arc-github-app >/dev/null 2>&1; then
  echo "Create the arc-github-app secret as documented before continuing." >&2
  exit 1
fi

helm upgrade --install arc-controller \
  --namespace arc-system \
  --version "$ARC_VERSION" \
  --values "$ROOT_DIR/controller-values.yaml" \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller

kubectl rollout status deployment \
  --namespace arc-system \
  --selector app.kubernetes.io/instance=arc-controller \
  --timeout=180s

kubectl apply -f "$ROOT_DIR/network-policy.yaml"

helm upgrade --install suite-e2e \
  --namespace arc-runners \
  --version "$ARC_VERSION" \
  --values "$ROOT_DIR/runner-scale-set-values.yaml" \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set

kubectl get pods --all-namespaces
