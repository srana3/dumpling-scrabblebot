import json,sys,collections,glob
rows=[]
for f in sorted(glob.glob('logs/live-*.jsonl')): rows+=[json.loads(l) for l in open(f)]
mids=[int(x) for x in sys.argv[1:]] or [r['matchId'] for r in rows if r['ev']=='match_end'][-3:]
for m in mids:
    res=[r for r in rows if r['ev']=='result' and r['matchId']==m]
    bids={r['aid']:r for r in rows if r['ev']=='auction' and r['matchId']==m}
    ends=[r for r in rows if r['ev']=='match_end' and r['matchId']==m]
    if not ends: continue
    end=ends[0]; names={x['botId']:x['name'] for x in end['rows']}
    st=collections.defaultdict(lambda:{'tiles':0,'paid':0})
    for r in res: s=st[r['winner']]; s['tiles']+=1; s['paid']+=r['paid']
    lost_by=[r['paid']-bids[r['aid']]['bid'] for r in res if not r['mine'] and r['aid'] in bids and bids[r['aid']]['bid']>0]
    over=[r['paid'] for r in res if r['mine']]
    print(f"match {m}: place {end['place']}/{end['n']} score {end['score']} leftover {end['leftover']}")
    print(f"  we won {len(over)} tiles, paid {sum(over)}; lost auctions: median shortfall {sorted(lost_by)[len(lost_by)//2] if lost_by else None}")
    for x in end['rows']:
        s=st.get(x['botId'],{'tiles':0,'paid':0})
        print(f"  {x['name']:16} score {x['score']:4} bal {x['balance']:3} tiles {s['tiles']:2} paid {s['paid']:4}")
