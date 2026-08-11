# Suite E2E Actions Runners

This directory deploys a repository-scoped ARC runner scale set on the dedicated
Suite CI host. Runner pods are ephemeral and use Docker-in-Docker because the E2E
workflows require MariaDB and Redis service containers.

## Security boundary

- The scale set is scoped to `frappe/suite`, starts at zero, and permits four
  concurrent jobs.
- E2E jobs run only for pushes, manual dispatches, and `pull_request_target`
  events whose head repository is `frappe/suite`. The protected base workflow
  enforces that gate before explicitly checking out the internal PR commit.
- Runner pods receive no Kubernetes API token and have no inbound network access.
- Egress permits DNS and public SSH/HTTP/HTTPS, but excludes private, loopback,
  carrier-grade NAT, link-local, and multicast IPv4 ranges.
- Kubernetes NetworkPolicy cannot block pod-to-node traffic. Keep no unrelated
  services or credentials on the node and restrict host administration with the
  provider firewall and SSH keys.
- DinD is privileged. Keep this cluster dedicated to CI and do not place
  production credentials or workloads on the host.

## Versions

| Component | Version |
| --- | --- |
| k3s | `v1.36.3+k3s1` |
| ARC charts | `0.14.2` |
| Actions Runner | `2.336.0` |
| Docker DinD | `29.1.3` (digest pinned) |

## GitHub App

An organization owner must create and install a GitHub App for only the
`frappe/suite` repository. Grant these repository permissions:

- Actions: read-only
- Administration: read and write
- Metadata: read-only

Create the secret directly on the host. Do not commit or paste the private key:

```bash
sudo k3s kubectl create namespace arc-runners --dry-run=client -o yaml \
  | sudo k3s kubectl apply -f -
sudo k3s kubectl create secret generic arc-github-app \
  --namespace arc-runners \
  --from-literal=github_app_id='<app-id>' \
  --from-literal=github_app_installation_id='<installation-id>' \
  --from-file=github_app_private_key='/root/github-app.private-key.pem'
sudo shred -u /root/github-app.private-key.pem
```

## Build the runner image

Run the `Build ARC Runner Image` workflow once from the protected default branch.
It publishes `ghcr.io/frappe/suite-actions-runner:2.336.0`. Set the resulting GHCR
package visibility to public so the cluster can pull it without registry
credentials.

## Install

Install Helm v4 on the host, clone this repository at a reviewed revision, then:

```bash
sudo .github/arc/bootstrap.sh
```

The script installs pinned k3s and ARC releases, applies the network policy, and
installs the `suite-e2e` scale set. It stops if an existing k3s installation has
the wrong version, is inactive, lacks the required flags, or if the GitHub App
secret is absent.

Verify the listener and trigger one E2E workflow manually:

```bash
sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl get pods -A
sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml helm list -A
```

## Operations

Drain the scale set before maintenance:

```bash
sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml helm upgrade suite-e2e \
  --namespace arc-runners \
  --version 0.14.2 \
  --reuse-values --set minRunners=0 --set maxRunners=0 \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set
```

Restore the four-runner limit with the bootstrap script. This configuration was
validated with 16 vCPUs and 30 GiB of allocatable memory; smaller hosts may not
schedule or reliably run four concurrent jobs.
