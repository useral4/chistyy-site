#!/bin/sh
set -eu
# Docker publishes bypass UFW. Restrict the worker in DOCKER-USER instead.
iptables -N KINAVA_WORKER 2>/dev/null || true
iptables -F KINAVA_WORKER
iptables -A KINAVA_WORKER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for destination in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 198.18.0.0/15 224.0.0.0/4; do
  iptables -A KINAVA_WORKER -d "$destination" -j REJECT
done
iptables -A KINAVA_WORKER -p tcp -m multiport --dports 80,443 -j RETURN
iptables -A KINAVA_WORKER -p udp --dport 53 -j RETURN
iptables -A KINAVA_WORKER -p tcp --dport 53 -j RETURN
iptables -A KINAVA_WORKER -j REJECT
iptables -C DOCKER-USER -s 172.30.0.3/32 -j KINAVA_WORKER 2>/dev/null || iptables -I DOCKER-USER 1 -s 172.30.0.3/32 -j KINAVA_WORKER
iptables -C INPUT -s 172.30.0.3/32 -m conntrack --ctstate NEW -j REJECT 2>/dev/null || iptables -I INPUT 1 -s 172.30.0.3/32 -m conntrack --ctstate NEW -j REJECT
